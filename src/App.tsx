import { useState, useRef, useEffect, useCallback } from 'react'
import { generatePdfFromElement } from './pdf/pdfGenerator'
import { initSupabase, fetchProjects, saveProject, deleteProjectFromDB, ProjectRow } from './lib/supabase'
import './App.css'

// Supabase 설정 (자동 연결)
const SUPABASE_URL = 'https://ulklqfzfbxxjafhloxyz.supabase.co'
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVsa2xxZnpmYnh4amFmaGxveHl6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njk3Njc1NjcsImV4cCI6MjA4NTM0MzU2N30.ipTuZWVvZupYDD5qdOvbcpKHG6QTUGSMoWAZQAU-tQw'

type Mode = 'simple' | 'ebook'
type PageSize = 'A4' | 'A5' | 'B5'
type BlockType = 'text' | 'heading' | 'image' | 'list' | 'quote' | 'table'
type View = 'home' | 'editor'

interface Block {
  id: string
  type: BlockType
  content: string
  x: number
  y: number
  width: number
  rotation?: number
  locked?: boolean
  style?: {
    fontSize?: number
    fontWeight?: string
    color?: string
    textAlign?: 'left' | 'center' | 'right'
    background?: string
    borderLeft?: string
    padding?: string
  }
}

interface Page {
  id: string
  blocks: Block[]
}

interface Guideline {
  id: string
  type: 'vertical' | 'horizontal'
  position: number
  locked: boolean
}

interface Project {
  id: string
  title: string
  createdAt: string
  updatedAt: string
  pageSize: PageSize
  pages: Page[]
  prompt: string
  chapters: string
}

const PAGE_SIZES: Record<PageSize, { width: number; height: number; label: string }> = {
  A4: { width: 210, height: 297, label: 'A4 (210×297mm)' },
  A5: { width: 148, height: 210, label: 'A5 (148×210mm)' },
  B5: { width: 182, height: 257, label: 'B5 (182×257mm)' },
}

const getPreviewSize = (size: PageSize) => {
  const ratio = PAGE_SIZES[size].height / PAGE_SIZES[size].width
  const width = 500
  return { width, height: width * ratio }
}

// 디자인 스타일 배리에이션
const HEADING_STYLES = [
  { background: 'linear-gradient(135deg, #667eea, #764ba2)', color: '#fff' },
  { background: 'linear-gradient(135deg, #f093fb, #f5576c)', color: '#fff' },
  { background: 'linear-gradient(135deg, #4facfe, #00f2fe)', color: '#fff' },
  { background: 'linear-gradient(135deg, #43e97b, #38f9d7)', color: '#1a1a2e' },
  { background: 'linear-gradient(135deg, #fa709a, #fee140)', color: '#1a1a2e' },
  { background: 'linear-gradient(135deg, #a8edea, #fed6e3)', color: '#1a1a2e' },
]

const QUOTE_STYLES = [
  { background: 'linear-gradient(135deg, #ffecd2, #fcb69f)', borderLeft: '4px solid #f093fb' },
  { background: 'linear-gradient(135deg, #a1c4fd, #c2e9fb)', borderLeft: '4px solid #667eea' },
  { background: 'linear-gradient(135deg, #d4fc79, #96e6a1)', borderLeft: '4px solid #43e97b' },
  { background: 'linear-gradient(135deg, #fbc2eb, #a6c1ee)', borderLeft: '4px solid #f5576c' },
  { background: 'linear-gradient(135deg, #fff1eb, #ace0f9)', borderLeft: '4px solid #4facfe' },
]

const SECTION_STYLES = [
  { background: 'linear-gradient(135deg, #e0c3fc, #8ec5fc)', color: '#1a1a2e' },
  { background: 'linear-gradient(135deg, #ffecd2, #fcb69f)', color: '#1a1a2e' },
  { background: 'linear-gradient(135deg, #667eea, #764ba2)', color: '#fff' },
]

let blockIdCounter = 0
const generateId = () => `block-${++blockIdCounter}`
const generateProjectId = () => `project-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`

let styleIndex = { heading: 0, quote: 0, section: 0 }

export default function App() {
  const [view, setView] = useState<View>('home')
  const [projects, setProjects] = useState<Project[]>([])
  const [currentProjectId, setCurrentProjectId] = useState<string | null>(null)
  const [isLoadingProjects, setIsLoadingProjects] = useState(false)
  const [isSupabaseConnected, setIsSupabaseConnected] = useState(false)
  
  const [mode, setMode] = useState<Mode>('ebook')
  const [apiKey, setApiKey] = useState(() => localStorage.getItem('claude_api_key') || '')
  const [pageSize, setPageSize] = useState<PageSize>('A4')
  const [prompt, setPrompt] = useState('')
  const [bookTitle, setBookTitle] = useState('')
  const [chapters, setChapters] = useState('')
  const [pageCount, setPageCount] = useState('5')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showApiKey, setShowApiKey] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  
  const [pages, setPages] = useState<Page[]>([])
  const [currentPageIndex, setCurrentPageIndex] = useState(0)
  const [selectedBlockIds, setSelectedBlockIds] = useState<string[]>([])
  const [isEditing, setIsEditing] = useState(false)
  const [isDragging, setIsDragging] = useState(false)
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 })
  const [editingBlockId, setEditingBlockId] = useState<string | null>(null)
  const [editingText, setEditingText] = useState('')
  
  // 드래그 선택 박스
  const [isSelecting, setIsSelecting] = useState(false)
  const [selectionStart, setSelectionStart] = useState({ x: 0, y: 0 })
  const [selectionEnd, setSelectionEnd] = useState({ x: 0, y: 0 })
  
  // 히스토리 (미리보기 전용)
  const [history, setHistory] = useState<Page[][]>([])
  const [historyIndex, setHistoryIndex] = useState(-1)
  
  // 가이드라인
  const [guidelines, setGuidelines] = useState<Guideline[]>([])
  const [showGuidelineMenu, setShowGuidelineMenu] = useState(false)
  
  const [isResizing, setIsResizing] = useState(false)
  const [resizeStart, setResizeStart] = useState({ x: 0, y: 0, width: 0 })
  
  const pageRef = useRef<HTMLDivElement>(null)
  const pagesContainerRef = useRef<HTMLDivElement>(null)
  const textInputRef = useRef<HTMLInputElement>(null)
  const previewRef = useRef<HTMLDivElement>(null)

  // Supabase 자동 초기화
  useEffect(() => {
    initSupabase(SUPABASE_URL, SUPABASE_ANON_KEY)
    setIsSupabaseConnected(true)
    loadProjectsFromSupabase()
  }, [])

  const loadProjectsFromSupabase = async () => {
    setIsLoadingProjects(true)
    try {
      const rows = await fetchProjects()
      const converted: Project[] = rows.map((row: ProjectRow) => ({
        id: row.id,
        title: row.title,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        pageSize: row.page_size as PageSize,
        pages: row.pages as Page[],
        prompt: row.prompt,
        chapters: row.chapters,
      }))
      setProjects(converted)
    } catch (e) {
      console.error(e)
    } finally {
      setIsLoadingProjects(false)
    }
  }

  const saveApiKey = () => {
    localStorage.setItem('claude_api_key', apiKey)
    setShowApiKey(false)
  }

  const currentPage = pages[currentPageIndex]
  const previewSize = getPreviewSize(pageSize)

  // 히스토리 저장
  const saveToHistory = useCallback((newPages: Page[]) => {
    setHistory(prev => {
      const newHistory = prev.slice(0, historyIndex + 1)
      newHistory.push(JSON.parse(JSON.stringify(newPages)))
      return newHistory.slice(-50)
    })
    setHistoryIndex(prev => Math.min(prev + 1, 49))
  }, [historyIndex])

  // Ctrl+Z / Ctrl+Y (미리보기 영역 포커스 시에만)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // 미리보기 영역에 포커스가 있을 때만 동작
      if (!previewRef.current?.contains(document.activeElement) && 
          document.activeElement?.tagName !== 'BODY') {
        return
      }
      
      if (e.ctrlKey && e.key === 'z') {
        e.preventDefault()
        if (historyIndex > 0) {
          const newIndex = historyIndex - 1
          setHistoryIndex(newIndex)
          setPages(JSON.parse(JSON.stringify(history[newIndex])))
        }
      }
      if (e.ctrlKey && e.key === 'y') {
        e.preventDefault()
        if (historyIndex < history.length - 1) {
          const newIndex = historyIndex + 1
          setHistoryIndex(newIndex)
          setPages(JSON.parse(JSON.stringify(history[newIndex])))
        }
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [history, historyIndex])

  // 텍스트 입력 시 전체선택
  useEffect(() => {
    if (editingBlockId && textInputRef.current) {
      textInputRef.current.select()
    }
  }, [editingBlockId])

  // 프로젝트 저장 (Supabase)
  const saveCurrentProject = async () => {
    if (!bookTitle.trim() || pages.length === 0) {
      setError('제목과 내용이 필요합니다')
      return
    }
    
    if (!isSupabaseConnected) {
      setError('DB 연결 중입니다. 잠시 후 다시 시도해주세요.')
      return
    }

    setIsSaving(true)
    const now = new Date().toISOString()
    const projectId = currentProjectId || generateProjectId()
    
    try {
      const result = await saveProject({
        id: projectId,
        title: bookTitle,
        updated_at: now,
        page_size: pageSize,
        pages: pages,
        prompt,
        chapters,
      })
      
      if (result) {
        setCurrentProjectId(projectId)
        await loadProjectsFromSupabase()
        setError(null)
      } else {
        setError('저장 실패')
      }
    } catch (e) {
      setError('저장 중 오류 발생')
    } finally {
      setIsSaving(false)
    }
  }

  // 프로젝트 불러오기
  const loadProject = (project: Project) => {
    setCurrentProjectId(project.id)
    setBookTitle(project.title)
    setPageSize(project.pageSize)
    setPages(project.pages)
    setPrompt(project.prompt)
    setChapters(project.chapters)
    setCurrentPageIndex(0)
    setHistory([project.pages])
    setHistoryIndex(0)
    setView('editor')
  }

  // 프로젝트 삭제
  const deleteProject = async (id: string) => {
    if (!confirm('정말 삭제하시겠습니까?')) return
    
    const success = await deleteProjectFromDB(id)
    if (success) {
      await loadProjectsFromSupabase()
    } else {
      setError('삭제 실패')
    }
  }

  // 새 프로젝트
  const createNewProject = () => {
    setCurrentProjectId(null)
    setBookTitle('')
    setPageSize('A4')
    setPages([])
    setPrompt('')
    setChapters('')
    setCurrentPageIndex(0)
    setHistory([])
    setHistoryIndex(-1)
    setGuidelines([])
    setView('editor')
  }

  // AI 콘텐츠 생성
  const generateContent = async () => {
    if (!apiKey.trim()) {
      setError('API 키를 입력해주세요')
      setShowApiKey(true)
      return
    }
    if (!prompt.trim()) {
      setError('내용을 입력해주세요')
      return
    }

    setIsLoading(true)
    setError(null)
    setPages([])
    setCurrentPageIndex(0)
    setHistory([])
    setHistoryIndex(-1)
    styleIndex = { heading: 0, quote: 0, section: 0 }

    const sizeInfo = PAGE_SIZES[pageSize]
    let userPrompt = prompt

    if (mode === 'ebook' && bookTitle) {
      userPrompt = `전자책을 작성해주세요.

제목: ${bookTitle}
${chapters ? `챕터 구성: ${chapters}` : ''}
분량: 약 ${pageCount}페이지 분량 (페이지 구분 없이 연속으로 작성)
용지: ${sizeInfo.label}

주제: ${prompt}

형식:
- # 책 제목 (맨 처음)
- ## 챕터 제목
- ### 소제목
- > 중요 포인트 (인용/강조)
- 표는 Markdown 형식
- **굵게** 강조
- 목록은 - 또는 1. 2. 3.

절대 금지사항:
- 코드 블록(\`\`\`) 사용 금지
- --- 구분선 사용 금지
- 페이지 구분 표시 금지

연속된 글로 작성해주세요. 페이지 나눔은 시스템이 자동으로 합니다.`
    }

    try {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true',
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 8192,
          stream: true,
          system: '전문 전자책 작가입니다. Markdown 형식으로 간결하게 작성합니다.',
          messages: [{ role: 'user', content: userPrompt }],
        }),
      })

      if (!response.ok) throw new Error('API 오류')

      const reader = response.body?.getReader()
      if (!reader) throw new Error('스트리밍 실패')

      const decoder = new TextDecoder()
      let fullContent = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        const chunk = decoder.decode(value)
        const lines = chunk.split('\n')

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6)
            if (data === '[DONE]') continue
            try {
              const parsed = JSON.parse(data)
              if (parsed.type === 'content_block_delta' && parsed.delta?.text) {
                fullContent += parsed.delta.text
                const newPages = parseMarkdownToPages(fullContent, previewSize)
                setPages(newPages)
              }
            } catch {}
          }
        }
      }
      
      const finalPages = parseMarkdownToPages(fullContent, previewSize)
      saveToHistory(finalPages)
      
    } catch (e) {
      setError(e instanceof Error ? e.message : 'API 호출 실패')
    } finally {
      setIsLoading(false)
    }
  }

  // Markdown → 페이지/블록 변환 (디자인 다양화)
  const parseMarkdownToPages = (content: string, size: { width: number; height: number }): Page[] => {
    const allLines = content.split('\n')
    const contentWidth = size.width * 0.84
    const startY = size.height * 0.06
    const maxY = size.height * 0.85
    const x = size.width * 0.08
    
    const pages: Page[] = []
    let currentBlocks: Block[] = []
    let y = startY
    let pageIdx = 0
    let lastWasEmpty = false
    let lastBlockType = ''
    
    for (const line of allLines) {
      const trimmed = line.trim()
      
      if (trimmed === '---' || trimmed === '***' || trimmed === '___') continue
      
      if (!trimmed) {
        if (!lastWasEmpty) {
          y += 6
          lastWasEmpty = true
        }
        continue
      }
      lastWasEmpty = false
      
      let blockHeight = 18
      let marginTop = 4
      let block: Block | null = null
      
      if (trimmed.startsWith('# ')) {
        blockHeight = 45
        marginTop = lastBlockType ? 12 : 0
        const style = HEADING_STYLES[styleIndex.heading % HEADING_STYLES.length]
        styleIndex.heading++
        block = {
          id: generateId(), type: 'heading', content: trimmed.slice(2),
          x, y: y + marginTop, width: contentWidth,
          style: { fontSize: 20, fontWeight: 'bold', textAlign: 'center', ...style, padding: '12px 16px' }
        }
        lastBlockType = 'h1'
      } else if (trimmed.startsWith('## ')) {
        blockHeight = 32
        marginTop = lastBlockType === 'h1' ? 8 : 12
        const style = SECTION_STYLES[styleIndex.section % SECTION_STYLES.length]
        styleIndex.section++
        block = {
          id: generateId(), type: 'heading', content: trimmed.slice(3),
          x, y: y + marginTop, width: contentWidth,
          style: { fontSize: 14, fontWeight: 'bold', ...style, padding: '10px 14px' }
        }
        lastBlockType = 'h2'
      } else if (trimmed.startsWith('### ')) {
        blockHeight = 24
        marginTop = 8
        block = {
          id: generateId(), type: 'heading', content: trimmed.slice(4),
          x, y: y + marginTop, width: contentWidth,
          style: { fontSize: 12, fontWeight: '600', color: '#4f46e5', background: 'linear-gradient(90deg, rgba(79,70,229,0.1), transparent)', padding: '6px 10px', borderLeft: '3px solid #4f46e5' }
        }
        lastBlockType = 'h3'
      } else if (trimmed.startsWith('> ')) {
        blockHeight = 32
        marginTop = 6
        const style = QUOTE_STYLES[styleIndex.quote % QUOTE_STYLES.length]
        styleIndex.quote++
        block = {
          id: generateId(), type: 'quote', content: trimmed.slice(2),
          x, y: y + marginTop, width: contentWidth,
          style: { ...style, padding: '10px 14px' }
        }
        lastBlockType = 'quote'
      } else if (trimmed.startsWith('- ') || /^\d+\./.test(trimmed)) {
        blockHeight = 16
        marginTop = lastBlockType === 'list' ? 2 : 4
        block = {
          id: generateId(), type: 'list', content: trimmed,
          x, y: y + marginTop, width: contentWidth,
        }
        lastBlockType = 'list'
      } else if (trimmed.startsWith('|')) {
        blockHeight = 18
        marginTop = lastBlockType === 'table' ? 0 : 4
        block = {
          id: generateId(), type: 'table', content: trimmed,
          x, y: y + marginTop, width: contentWidth,
        }
        lastBlockType = 'table'
      } else {
        blockHeight = 16 + Math.floor(trimmed.length / 55) * 13
        marginTop = lastBlockType === 'text' ? 3 : 5
        block = {
          id: generateId(), type: 'text', content: trimmed,
          x, y: y + marginTop, width: contentWidth,
        }
        lastBlockType = 'text'
      }
      
      const totalHeight = marginTop + blockHeight
      
      if (y + totalHeight > maxY && currentBlocks.length > 0) {
        pages.push({ id: `page-${pageIdx}`, blocks: currentBlocks })
        pageIdx++
        currentBlocks = []
        y = startY
        lastBlockType = ''
        if (block) block.y = y
        y += blockHeight
      } else {
        y += totalHeight
      }
      
      if (block) currentBlocks.push(block)
    }
    
    if (currentBlocks.length > 0) {
      pages.push({ id: `page-${pageIdx}`, blocks: currentBlocks })
    }
    
    return pages.length > 0 ? pages : [{ id: 'page-0', blocks: [] }]
  }

  // 페이지 업데이트 (히스토리 저장)
  const updatePages = (updater: (prev: Page[]) => Page[]) => {
    setPages(prev => {
      const newPages = updater(prev)
      saveToHistory(newPages)
      return newPages
    })
  }

  // 스냅 위치 계산
  const getSnappedPosition = (x: number, y: number, blockWidth: number) => {
    const snapThreshold = 8
    let snappedX = x
    let snappedY = y
    
    for (const guide of guidelines) {
      if (guide.type === 'vertical') {
        // 왼쪽 모서리 스냅
        if (Math.abs(x - guide.position) < snapThreshold) {
          snappedX = guide.position
        }
        // 오른쪽 모서리 스냅
        if (Math.abs(x + blockWidth - guide.position) < snapThreshold) {
          snappedX = guide.position - blockWidth
        }
      } else {
        if (Math.abs(y - guide.position) < snapThreshold) {
          snappedY = guide.position
        }
      }
    }
    
    return { x: snappedX, y: snappedY }
  }

  // 블록 클릭
  const handleBlockClick = (e: React.MouseEvent, blockId: string) => {
    if (!isEditing) return
    e.stopPropagation()
    
    const block = currentPage?.blocks.find(b => b.id === blockId)
    if (block?.locked) return
    
    if (e.shiftKey) {
      // Shift+클릭: 다중 선택
      setSelectedBlockIds(prev => 
        prev.includes(blockId) ? prev.filter(id => id !== blockId) : [...prev, blockId]
      )
    } else {
      setSelectedBlockIds([blockId])
    }
  }

  // 블록 더블클릭
  const handleBlockDoubleClick = (e: React.MouseEvent, block: Block) => {
    if (!isEditing || block.type === 'image' || block.locked) return
    e.stopPropagation()
    setEditingBlockId(block.id)
    setEditingText(block.content)
  }

  // 텍스트 입력 클릭 (개별 선택)
  const handleTextInputClick = (e: React.MouseEvent<HTMLInputElement>) => {
    e.stopPropagation()
    // 이미 편집 중이면 클릭 위치로 커서 이동 (기본 동작)
  }

  // 텍스트 수정 완료
  const handleTextEditComplete = () => {
    if (!editingBlockId) return
    updatePages(prev => prev.map((page, idx) => {
      if (idx !== currentPageIndex) return page
      return {
        ...page,
        blocks: page.blocks.map(block => 
          block.id === editingBlockId ? { ...block, content: editingText } : block
        )
      }
    }))
    setEditingBlockId(null)
    setEditingText('')
  }

  // 드래그 시작
  const handleMouseDown = (e: React.MouseEvent, blockId: string) => {
    if (!isEditing || isResizing) return
    
    const block = currentPage?.blocks.find(b => b.id === blockId)
    if (block?.locked) return
    
    e.preventDefault()
    
    if (!selectedBlockIds.includes(blockId)) {
      setSelectedBlockIds([blockId])
    }
    
    setIsDragging(true)
    setDragOffset({ x: e.nativeEvent.offsetX, y: e.nativeEvent.offsetY })
  }

  // 페이지 마우스 다운 (드래그 선택 시작)
  const handlePageMouseDown = (e: React.MouseEvent) => {
    if (!isEditing || e.target !== pageRef.current) return
    
    const rect = pageRef.current!.getBoundingClientRect()
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top
    
    setIsSelecting(true)
    setSelectionStart({ x, y })
    setSelectionEnd({ x, y })
    setSelectedBlockIds([])
  }

  // 드래그 중
  const handleMouseMove = (e: React.MouseEvent) => {
    if (!pageRef.current) return
    const rect = pageRef.current.getBoundingClientRect()
    const mouseX = e.clientX - rect.left
    const mouseY = e.clientY - rect.top
    
    // 드래그 선택
    if (isSelecting) {
      setSelectionEnd({ x: mouseX, y: mouseY })
      
      // 선택 영역 내 블록 찾기
      const minX = Math.min(selectionStart.x, mouseX)
      const maxX = Math.max(selectionStart.x, mouseX)
      const minY = Math.min(selectionStart.y, mouseY)
      const maxY = Math.max(selectionStart.y, mouseY)
      
      const selected = currentPage?.blocks
        .filter(b => !b.locked && b.x < maxX && b.x + b.width > minX && b.y < maxY && b.y + 30 > minY)
        .map(b => b.id) || []
      
      setSelectedBlockIds(selected)
      return
    }
    
    // 블록 드래그
    if (isDragging && selectedBlockIds.length > 0) {
      const primaryBlock = currentPage?.blocks.find(b => b.id === selectedBlockIds[0])
      if (!primaryBlock) return
      
      let newX = mouseX - dragOffset.x
      let newY = mouseY - dragOffset.y
      
      // 스냅
      const snapped = getSnappedPosition(newX, newY, primaryBlock.width)
      const deltaX = snapped.x - primaryBlock.x
      const deltaY = snapped.y - primaryBlock.y
      
      setPages(prev => prev.map((page, idx) => {
        if (idx !== currentPageIndex) return page
        return {
          ...page,
          blocks: page.blocks.map(block => {
            if (!selectedBlockIds.includes(block.id) || block.locked) return block
            return { 
              ...block, 
              x: Math.max(0, block.x + deltaX), 
              y: Math.max(0, block.y + deltaY) 
            }
          })
        }
      }))
    }
    
    // 리사이즈
    if (isResizing && selectedBlockIds.length > 0) {
      const newWidth = Math.max(50, resizeStart.width + (e.clientX - resizeStart.x))
      setPages(prev => prev.map((page, idx) => {
        if (idx !== currentPageIndex) return page
        return {
          ...page,
          blocks: page.blocks.map(block => 
            block.id === selectedBlockIds[0] ? { ...block, width: newWidth } : block
          )
        }
      }))
    }
  }

  // 드래그/리사이즈 끝
  const handleMouseUp = () => {
    if (isDragging || isResizing) {
      saveToHistory(pages)
    }
    setIsDragging(false)
    setIsResizing(false)
    setIsSelecting(false)
  }

  // 리사이즈 시작
  const handleResizeStart = (e: React.MouseEvent, block: Block) => {
    e.stopPropagation()
    e.preventDefault()
    setSelectedBlockIds([block.id])
    setIsResizing(true)
    setResizeStart({ x: e.clientX, y: e.clientY, width: block.width })
  }

  // 이미지 회전
  const handleRotate = () => {
    if (selectedBlockIds.length === 0) return
    updatePages(prev => prev.map((page, idx) => {
      if (idx !== currentPageIndex) return page
      return {
        ...page,
        blocks: page.blocks.map(block => {
          if (!selectedBlockIds.includes(block.id)) return block
          return { ...block, rotation: ((block.rotation || 0) + 90) % 360 }
        })
      }
    }))
  }

  // 정렬 변경
  const handleAlign = (align: 'left' | 'center' | 'right') => {
    if (selectedBlockIds.length === 0) return
    updatePages(prev => prev.map((page, idx) => {
      if (idx !== currentPageIndex) return page
      return {
        ...page,
        blocks: page.blocks.map(block => 
          selectedBlockIds.includes(block.id) ? { ...block, style: { ...block.style, textAlign: align } } : block
        )
      }
    }))
  }

  // 이미지 추가
  const handleAddImage = () => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'image/*'
    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0]
      if (!file) return
      
      const reader = new FileReader()
      reader.onload = (ev) => {
        const newBlock: Block = {
          id: generateId(),
          type: 'image',
          content: ev.target?.result as string,
          x: previewSize.width * 0.15,
          y: previewSize.height * 0.2,
          width: previewSize.width * 0.7,
          rotation: 0,
        }
        updatePages(prev => prev.map((page, idx) => {
          if (idx !== currentPageIndex) return page
          return { ...page, blocks: [...page.blocks, newBlock] }
        }))
      }
      reader.readAsDataURL(file)
    }
    input.click()
  }

  // 블록 삭제
  const handleDeleteBlock = () => {
    if (selectedBlockIds.length === 0) return
    updatePages(prev => prev.map((page, idx) => {
      if (idx !== currentPageIndex) return page
      return { ...page, blocks: page.blocks.filter(b => !selectedBlockIds.includes(b.id) || b.locked) }
    }))
    setSelectedBlockIds([])
  }

  // 블록 잠금/해제
  const handleToggleLock = () => {
    if (selectedBlockIds.length === 0) return
    updatePages(prev => prev.map((page, idx) => {
      if (idx !== currentPageIndex) return page
      return {
        ...page,
        blocks: page.blocks.map(block => 
          selectedBlockIds.includes(block.id) ? { ...block, locked: !block.locked } : block
        )
      }
    }))
  }

  // 가이드라인 추가
  const addGuideline = (type: 'vertical' | 'horizontal') => {
    const newGuide: Guideline = {
      id: `guide-${Date.now()}`,
      type,
      position: type === 'vertical' ? previewSize.width * 0.08 : previewSize.height * 0.06,
      locked: false,
    }
    setGuidelines(prev => [...prev, newGuide])
    setShowGuidelineMenu(false)
  }

  // 가이드라인 잠금
  const toggleGuidelineLock = (id: string) => {
    setGuidelines(prev => prev.map(g => g.id === id ? { ...g, locked: !g.locked } : g))
  }

  // 가이드라인 삭제
  const deleteGuideline = (id: string) => {
    setGuidelines(prev => prev.filter(g => g.id !== id))
  }

  // PDF 다운로드
  const downloadPdf = async () => {
    if (pages.length === 0) return setError('먼저 내용을 생성해주세요')
    try {
      if (!pagesContainerRef.current) throw new Error('컨테이너 없음')
      await generatePdfFromElement(pagesContainerRef.current, bookTitle || 'document', pageSize)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'PDF 생성 실패')
    }
  }

  const handlePageClick = () => {
    setSelectedBlockIds([])
  }

  const selectedBlock = selectedBlockIds.length === 1 
    ? currentPage?.blocks.find(b => b.id === selectedBlockIds[0]) 
    : null

  // 선택 박스 스타일
  const selectionBoxStyle = isSelecting ? {
    left: Math.min(selectionStart.x, selectionEnd.x),
    top: Math.min(selectionStart.y, selectionEnd.y),
    width: Math.abs(selectionEnd.x - selectionStart.x),
    height: Math.abs(selectionEnd.y - selectionStart.y),
  } : null

  // 홈 화면
  if (view === 'home') {
    return (
      <div className="app">
        <header className="header single-bar">
          <div className="header-left">
            <h1>📚 AI 전자책 제작</h1>
          </div>
          <div className="header-right">
            {isSupabaseConnected && <span className="status-badge">🟢 DB 연결됨</span>}
            <button className="btn btn-primary" onClick={createNewProject}>+ 새 프로젝트</button>
          </div>
        </header>

        {error && (
          <div className="error-bar">
            <span>⚠️ {error}</span>
            <button onClick={() => setError(null)}>✕</button>
          </div>
        )}

        <div className="home-content">
          {isLoadingProjects ? (
            <div className="loading-center">
              <span className="spinner"></span>
              <p>프로젝트 불러오는 중...</p>
            </div>
          ) : projects.length === 0 ? (
            <div className="empty-home">
              <div className="empty-icon">📖</div>
              <h2>아직 프로젝트가 없습니다</h2>
              <p>새 프로젝트를 만들어 AI와 함께 전자책을 제작해보세요!</p>
              <button className="btn btn-primary btn-large" onClick={createNewProject}>+ 새 프로젝트 시작</button>
            </div>
          ) : (
            <div className="projects-grid">
              {projects.map(project => (
                <div key={project.id} className="project-card" onClick={() => loadProject(project)}>
                  <div className="project-preview">
                    <span className="project-pages">{project.pages.length}p</span>
                  </div>
                  <div className="project-info">
                    <h3>{project.title || '제목 없음'}</h3>
                    <p className="project-date">
                      {new Date(project.updatedAt).toLocaleDateString('ko-KR')}
                    </p>
                  </div>
                  <button 
                    className="project-delete" 
                    onClick={(e) => { e.stopPropagation(); deleteProject(project.id) }}
                  >
                    🗑️
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    )
  }

  // 에디터 화면
  return (
    <div className="app">
      {/* 통합 상단바 */}
      <header className="header single-bar">
        <div className="header-left">
          <button className="btn btn-ghost btn-sm" onClick={() => setView('home')}>← 홈</button>
          <h1>📚 {bookTitle || '새 프로젝트'}</h1>
          <div className="mode-tabs">
            <button className={`tab ${mode === 'ebook' ? 'active' : ''}`} onClick={() => setMode('ebook')}>전자책</button>
            <button className={`tab ${mode === 'simple' ? 'active' : ''}`} onClick={() => setMode('simple')}>문서</button>
          </div>
        </div>
        
        <div className="header-center">
          {/* 편집 도구 */}
          {isEditing && (
            <div className="toolbar-inline">
              <button onClick={() => handleAlign('left')} className="tool-btn" title="왼쪽 정렬">◀</button>
              <button onClick={() => handleAlign('center')} className="tool-btn" title="가운데 정렬">●</button>
              <button onClick={() => handleAlign('right')} className="tool-btn" title="오른쪽 정렬">▶</button>
              <span className="toolbar-divider" />
              <button onClick={handleAddImage} className="tool-btn" title="이미지 추가">🖼️</button>
              <button onClick={handleRotate} disabled={!selectedBlock || selectedBlock.type !== 'image'} className="tool-btn" title="회전">🔄</button>
              <span className="toolbar-divider" />
              <button onClick={handleToggleLock} disabled={selectedBlockIds.length === 0} className="tool-btn" title="잠금/해제">
                {selectedBlock?.locked ? '🔓' : '🔒'}
              </button>
              <div className="dropdown">
                <button onClick={() => setShowGuidelineMenu(!showGuidelineMenu)} className="tool-btn" title="가이드라인">📏</button>
                {showGuidelineMenu && (
                  <div className="dropdown-menu">
                    <button onClick={() => addGuideline('vertical')}>세로 가이드</button>
                    <button onClick={() => addGuideline('horizontal')}>가로 가이드</button>
                  </div>
                )}
              </div>
              <button onClick={handleDeleteBlock} disabled={selectedBlockIds.length === 0} className="tool-btn danger" title="삭제">🗑️</button>
            </div>
          )}
          
          {/* 페이지 네비게이션 */}
          {pages.length > 0 && (
            <div className="page-nav-inline">
              <button onClick={() => setCurrentPageIndex(Math.max(0, currentPageIndex - 1))} disabled={currentPageIndex === 0}>◀</button>
              <span>{currentPageIndex + 1} / {pages.length}</span>
              <button onClick={() => setCurrentPageIndex(Math.min(pages.length - 1, currentPageIndex + 1))} disabled={currentPageIndex >= pages.length - 1}>▶</button>
            </div>
          )}
        </div>
        
        <div className="header-right">
          <span className="shortcut-hint">Ctrl+Z: 되돌리기</span>
          <button onClick={() => setIsEditing(!isEditing)} disabled={pages.length === 0} className={`btn btn-sm ${isEditing ? 'btn-warning' : 'btn-secondary'}`}>
            {isEditing ? '✓ 완료' : '✏️ 편집'}
          </button>
          <button onClick={downloadPdf} disabled={pages.length === 0} className="btn btn-sm btn-success">📥 PDF</button>
          <button className="btn btn-sm btn-primary" onClick={saveCurrentProject} disabled={pages.length === 0 || isSaving}>
            {isSaving ? '...' : '💾 저장'}
          </button>
          <button className="btn btn-ghost btn-sm" onClick={() => setShowApiKey(!showApiKey)}>⚙️</button>
        </div>
      </header>

      {showApiKey && (
        <div className="api-bar">
          <div className="api-input-group">
            <label>Claude API 키:</label>
            <input type="password" placeholder="sk-ant-..." value={apiKey} onChange={(e) => setApiKey(e.target.value)} />
            <button onClick={saveApiKey} className="btn btn-primary btn-sm">저장</button>
          </div>
        </div>
      )}

      {error && (
        <div className="error-bar">
          <span>⚠️ {error}</span>
          <button onClick={() => setError(null)}>✕</button>
        </div>
      )}

      <div className="main compact">
        <div className="input-section compact">
          <div className="section-block">
            <h3>📐 용지</h3>
            <div className="page-size-selector compact">
              {(Object.keys(PAGE_SIZES) as PageSize[]).map((size) => (
                <button key={size} className={`size-btn ${pageSize === size ? 'active' : ''}`} onClick={() => setPageSize(size)}>
                  {size}
                </button>
              ))}
            </div>
          </div>

          {mode === 'ebook' && (
            <div className="section-block">
              <h3>📖 책 정보</h3>
              <input type="text" placeholder="책 제목" value={bookTitle} onChange={(e) => setBookTitle(e.target.value)} className="input-compact" />
              <div className="form-row compact">
                <input type="text" placeholder="챕터 구성" value={chapters} onChange={(e) => setChapters(e.target.value)} className="input-compact" />
                <input type="number" min="1" max="50" value={pageCount} onChange={(e) => setPageCount(e.target.value)} className="input-compact small" placeholder="페이지" />
              </div>
            </div>
          )}

          <div className="section-block flex-grow">
            <h3>✍️ 내용</h3>
            <textarea placeholder="책에서 다룰 주제를 입력하세요..." value={prompt} onChange={(e) => setPrompt(e.target.value)} className="textarea-compact" />
          </div>

          <button onClick={generateContent} disabled={isLoading} className="btn btn-primary btn-full">
            {isLoading ? (<><span className="spinner-small"></span>생성 중...</>) : '✨ AI로 작성'}
          </button>
        </div>

        <div className="preview-section" ref={previewRef} tabIndex={-1}>
          {/* 가이드라인 컨트롤 */}
          {guidelines.length > 0 && isEditing && (
            <div className="guideline-controls">
              {guidelines.map(g => (
                <div key={g.id} className="guideline-item">
                  <span>{g.type === 'vertical' ? '세로' : '가로'} {Math.round(g.position)}px</span>
                  <button onClick={() => toggleGuidelineLock(g.id)} className="btn-mini">{g.locked ? '🔒' : '🔓'}</button>
                  <button onClick={() => deleteGuideline(g.id)} className="btn-mini">✕</button>
                </div>
              ))}
            </div>
          )}

          <div className="preview-container">
            {pages.length > 0 && currentPage ? (
              <div
                ref={pageRef}
                className={`book-page ${isEditing ? 'editing' : ''}`}
                style={{ width: previewSize.width, height: previewSize.height }}
                onClick={handlePageClick}
                onMouseDown={handlePageMouseDown}
                onMouseMove={handleMouseMove}
                onMouseUp={handleMouseUp}
                onMouseLeave={handleMouseUp}
              >
                {/* 가이드라인 */}
                {guidelines.map(g => (
                  <div
                    key={g.id}
                    className={`guideline ${g.type} ${g.locked ? 'locked' : ''}`}
                    style={g.type === 'vertical' ? { left: g.position } : { top: g.position }}
                  />
                ))}
                
                {/* 선택 박스 */}
                {selectionBoxStyle && (
                  <div className="selection-box" style={selectionBoxStyle} />
                )}
                
                {currentPage.blocks.map(block => (
                  <div
                    key={block.id}
                    className={`block ${block.type} ${selectedBlockIds.includes(block.id) ? 'selected' : ''} ${isEditing ? 'editable' : ''} ${block.locked ? 'locked' : ''}`}
                    style={{
                      left: block.x,
                      top: block.y,
                      width: block.width,
                      fontSize: block.style?.fontSize,
                      fontWeight: block.style?.fontWeight,
                      color: block.style?.color,
                      textAlign: block.style?.textAlign,
                      background: block.style?.background,
                      borderLeft: block.style?.borderLeft,
                      padding: block.style?.padding,
                      transform: block.rotation ? `rotate(${block.rotation}deg)` : undefined,
                    }}
                    onClick={(e) => handleBlockClick(e, block.id)}
                    onMouseDown={(e) => handleMouseDown(e, block.id)}
                    onDoubleClick={(e) => handleBlockDoubleClick(e, block)}
                  >
                    {editingBlockId === block.id ? (
                      <input
                        ref={textInputRef}
                        type="text"
                        className="block-input"
                        value={editingText}
                        onChange={(e) => setEditingText(e.target.value)}
                        onClick={handleTextInputClick}
                        onBlur={handleTextEditComplete}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') handleTextEditComplete()
                        }}
                        autoFocus
                      />
                    ) : block.type === 'image' ? (
                      <>
                        <img src={block.content} alt="" style={{ width: '100%' }} />
                        {isEditing && selectedBlockIds.includes(block.id) && !block.locked && (
                          <div className="resize-handle" onMouseDown={(e) => handleResizeStart(e, block)} />
                        )}
                      </>
                    ) : block.type === 'quote' ? (
                      <div className="quote-content">💡 {block.content}</div>
                    ) : block.type === 'list' ? (
                      <div className="list-content">{block.content.startsWith('-') ? '• ' : ''}{block.content.replace(/^-\s*/, '').replace(/^\d+\.\s*/, '')}</div>
                    ) : (
                      <span dangerouslySetInnerHTML={{ __html: block.content.replace(/\*\*(.+?)\*\*/g, '<strong style="color:#dc2626">$1</strong>') }} />
                    )}
                    {block.locked && <span className="lock-indicator">🔒</span>}
                  </div>
                ))}
                <div className="page-number">{currentPageIndex + 1}</div>
              </div>
            ) : (
              <div className="empty-preview" style={{ width: previewSize.width, height: previewSize.height }}>
                <div className="empty-icon">📄</div>
                <p>AI가 작성한 내용이 여기에 표시됩니다</p>
              </div>
            )}
          </div>

          <div ref={pagesContainerRef} id="pdf-pages-container" className="pdf-hidden">
            {pages.map((page, pageIdx) => (
              <div key={page.id} className="book-page for-pdf" style={{ width: previewSize.width, height: previewSize.height }}>
                {page.blocks.map(block => (
                  <div
                    key={block.id}
                    className={`block ${block.type}`}
                    style={{
                      left: block.x, top: block.y, width: block.width,
                      fontSize: block.style?.fontSize,
                      fontWeight: block.style?.fontWeight,
                      color: block.style?.color,
                      textAlign: block.style?.textAlign,
                      background: block.style?.background,
                      borderLeft: block.style?.borderLeft,
                      padding: block.style?.padding,
                      transform: block.rotation ? `rotate(${block.rotation}deg)` : undefined,
                    }}
                  >
                    {block.type === 'image' ? (
                      <img src={block.content} alt="" style={{ width: '100%' }} />
                    ) : block.type === 'quote' ? (
                      <div className="quote-content">💡 {block.content}</div>
                    ) : block.type === 'list' ? (
                      <div className="list-content">{block.content.startsWith('-') ? '• ' : ''}{block.content.replace(/^-\s*/, '').replace(/^\d+\.\s*/, '')}</div>
                    ) : (
                      <span dangerouslySetInnerHTML={{ __html: block.content.replace(/\*\*(.+?)\*\*/g, '<strong style="color:#dc2626">$1</strong>') }} />
                    )}
                  </div>
                ))}
                <div className="page-number">{pageIdx + 1}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
