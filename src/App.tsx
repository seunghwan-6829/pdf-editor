import { useState, useRef, useEffect, useCallback } from 'react'
import { generatePdfFromElement } from './pdf/pdfGenerator'
import { initSupabase, fetchProjects, saveProject, deleteProjectFromDB } from './lib/supabase'
import './App.css'

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
  style?: {
    fontSize?: number
    fontWeight?: string
    color?: string
    textAlign?: 'left' | 'center' | 'right'
    background?: string
  }
}

interface Page {
  id: string
  blocks: Block[]
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

let blockIdCounter = 0
const generateId = () => `block-${++blockIdCounter}`
const generateProjectId = () => `project-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`

export default function App() {
  const [view, setView] = useState<View>('home')
  const [projects, setProjects] = useState<Project[]>([])
  const [currentProjectId, setCurrentProjectId] = useState<string | null>(null)
  const [isLoadingProjects, setIsLoadingProjects] = useState(false)
  
  // Supabase 설정
  const [supabaseUrl, setSupabaseUrl] = useState(() => localStorage.getItem('supabase_url') || '')
  const [supabaseKey, setSupabaseKey] = useState(() => localStorage.getItem('supabase_key') || '')
  const [isSupabaseConnected, setIsSupabaseConnected] = useState(false)
  const [showSupabaseSetup, setShowSupabaseSetup] = useState(false)
  
  const [mode, setMode] = useState<Mode>('ebook')
  const [apiKey, setApiKey] = useState(() => localStorage.getItem('claude_api_key') || '')
  const [pageSize, setPageSize] = useState<PageSize>('A4')
  const [prompt, setPrompt] = useState('')
  const [bookTitle, setBookTitle] = useState('')
  const [chapters, setChapters] = useState('')
  const [pageCount, setPageCount] = useState('5')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showApiKey, setShowApiKey] = useState(!apiKey)
  const [isSaving, setIsSaving] = useState(false)
  
  const [pages, setPages] = useState<Page[]>([])
  const [currentPageIndex, setCurrentPageIndex] = useState(0)
  const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null)
  const [isEditing, setIsEditing] = useState(false)
  const [isDragging, setIsDragging] = useState(false)
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 })
  const [editingBlockId, setEditingBlockId] = useState<string | null>(null)
  const [editingText, setEditingText] = useState('')
  
  const [history, setHistory] = useState<Page[][]>([])
  const [historyIndex, setHistoryIndex] = useState(-1)
  
  const [isResizing, setIsResizing] = useState(false)
  const [resizeStart, setResizeStart] = useState({ x: 0, y: 0, width: 0 })
  
  const pageRef = useRef<HTMLDivElement>(null)
  const pagesContainerRef = useRef<HTMLDivElement>(null)
  const textInputRef = useRef<HTMLInputElement>(null)

  // Supabase 초기화
  useEffect(() => {
    if (supabaseUrl && supabaseKey) {
      initSupabase(supabaseUrl, supabaseKey)
      setIsSupabaseConnected(true)
      loadProjectsFromSupabase()
    }
  }, [])

  const connectSupabase = () => {
    if (!supabaseUrl || !supabaseKey) {
      setError('Supabase URL과 API Key를 입력해주세요')
      return
    }
    localStorage.setItem('supabase_url', supabaseUrl)
    localStorage.setItem('supabase_key', supabaseKey)
    initSupabase(supabaseUrl, supabaseKey)
    setIsSupabaseConnected(true)
    setShowSupabaseSetup(false)
    loadProjectsFromSupabase()
  }

  const loadProjectsFromSupabase = async () => {
    setIsLoadingProjects(true)
    try {
      const rows = await fetchProjects()
      const converted: Project[] = rows.map(row => ({
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

  // Ctrl+Z / Ctrl+Y
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
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
      setError('Supabase 연결이 필요합니다')
      setShowSupabaseSetup(true)
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
- > 중요 포인트
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

  // Markdown → 페이지/블록 변환
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
        blockHeight = 40
        marginTop = lastBlockType ? 12 : 0
        block = {
          id: generateId(), type: 'heading', content: trimmed.slice(2),
          x, y: y + marginTop, width: contentWidth,
          style: { fontSize: 20, fontWeight: 'bold', textAlign: 'center', color: '#1e40af', background: 'linear-gradient(135deg, #eff6ff, #dbeafe)' }
        }
        lastBlockType = 'h1'
      } else if (trimmed.startsWith('## ')) {
        blockHeight = 28
        marginTop = lastBlockType === 'h1' ? 8 : 10
        block = {
          id: generateId(), type: 'heading', content: trimmed.slice(3),
          x, y: y + marginTop, width: contentWidth,
          style: { fontSize: 13, fontWeight: 'bold', color: '#fff', background: 'linear-gradient(135deg, #3b82f6, #1d4ed8)' }
        }
        lastBlockType = 'h2'
      } else if (trimmed.startsWith('### ')) {
        blockHeight = 20
        marginTop = 8
        block = {
          id: generateId(), type: 'heading', content: trimmed.slice(4),
          x, y: y + marginTop, width: contentWidth,
          style: { fontSize: 11, fontWeight: '600', color: '#1e40af' }
        }
        lastBlockType = 'h3'
      } else if (trimmed.startsWith('> ')) {
        blockHeight = 28
        marginTop = 6
        block = {
          id: generateId(), type: 'quote', content: trimmed.slice(2),
          x, y: y + marginTop, width: contentWidth,
          style: { background: 'linear-gradient(135deg, #fef3c7, #fde68a)' }
        }
        lastBlockType = 'quote'
      } else if (trimmed.startsWith('- ') || /^\d+\./.test(trimmed)) {
        blockHeight = 14
        marginTop = lastBlockType === 'list' ? 2 : 4
        block = {
          id: generateId(), type: 'list', content: trimmed,
          x, y: y + marginTop, width: contentWidth,
        }
        lastBlockType = 'list'
      } else if (trimmed.startsWith('|')) {
        blockHeight = 16
        marginTop = lastBlockType === 'table' ? 0 : 4
        block = {
          id: generateId(), type: 'table', content: trimmed,
          x, y: y + marginTop, width: contentWidth,
        }
        lastBlockType = 'table'
      } else {
        blockHeight = 14 + Math.floor(trimmed.length / 55) * 12
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

  // 블록 클릭
  const handleBlockClick = (e: React.MouseEvent, blockId: string) => {
    if (!isEditing) return
    e.stopPropagation()
    setSelectedBlockId(blockId)
  }

  // 블록 더블클릭
  const handleBlockDoubleClick = (e: React.MouseEvent, block: Block) => {
    if (!isEditing || block.type === 'image') return
    e.stopPropagation()
    setEditingBlockId(block.id)
    setEditingText(block.content)
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
    e.preventDefault()
    setSelectedBlockId(blockId)
    setIsDragging(true)
    setDragOffset({ x: e.nativeEvent.offsetX, y: e.nativeEvent.offsetY })
  }

  // 드래그 중
  const handleMouseMove = (e: React.MouseEvent) => {
    if (!pageRef.current) return
    const rect = pageRef.current.getBoundingClientRect()
    
    if (isDragging && selectedBlockId) {
      const newX = e.clientX - rect.left - dragOffset.x
      const newY = e.clientY - rect.top - dragOffset.y
      setPages(prev => prev.map((page, idx) => {
        if (idx !== currentPageIndex) return page
        return {
          ...page,
          blocks: page.blocks.map(block => 
            block.id === selectedBlockId ? { ...block, x: Math.max(0, newX), y: Math.max(0, newY) } : block
          )
        }
      }))
    }
    
    if (isResizing && selectedBlockId) {
      const newWidth = Math.max(50, resizeStart.width + (e.clientX - resizeStart.x))
      setPages(prev => prev.map((page, idx) => {
        if (idx !== currentPageIndex) return page
        return {
          ...page,
          blocks: page.blocks.map(block => 
            block.id === selectedBlockId ? { ...block, width: newWidth } : block
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
  }

  // 리사이즈 시작
  const handleResizeStart = (e: React.MouseEvent, block: Block) => {
    e.stopPropagation()
    e.preventDefault()
    setSelectedBlockId(block.id)
    setIsResizing(true)
    setResizeStart({ x: e.clientX, y: e.clientY, width: block.width })
  }

  // 이미지 회전
  const handleRotate = () => {
    if (!selectedBlockId) return
    updatePages(prev => prev.map((page, idx) => {
      if (idx !== currentPageIndex) return page
      return {
        ...page,
        blocks: page.blocks.map(block => {
          if (block.id !== selectedBlockId) return block
          return { ...block, rotation: ((block.rotation || 0) + 90) % 360 }
        })
      }
    }))
  }

  // 정렬 변경
  const handleAlign = (align: 'left' | 'center' | 'right') => {
    if (!selectedBlockId) return
    updatePages(prev => prev.map((page, idx) => {
      if (idx !== currentPageIndex) return page
      return {
        ...page,
        blocks: page.blocks.map(block => 
          block.id === selectedBlockId ? { ...block, style: { ...block.style, textAlign: align } } : block
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
    if (!selectedBlockId) return
    updatePages(prev => prev.map((page, idx) => {
      if (idx !== currentPageIndex) return page
      return { ...page, blocks: page.blocks.filter(b => b.id !== selectedBlockId) }
    }))
    setSelectedBlockId(null)
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

  const handlePageClick = () => setSelectedBlockId(null)
  const selectedBlock = currentPage?.blocks.find(b => b.id === selectedBlockId)

  // 홈 화면
  if (view === 'home') {
    return (
      <div className="app">
        <header className="header">
          <div className="header-left">
            <h1>📚 AI 전자책 제작</h1>
          </div>
          <div className="header-right">
            <button className="btn btn-ghost" onClick={() => setShowSupabaseSetup(!showSupabaseSetup)}>
              {isSupabaseConnected ? '🟢 연결됨' : '⚙️ DB 설정'}
            </button>
            <button className="btn btn-primary" onClick={createNewProject}>+ 새 프로젝트</button>
          </div>
        </header>

        {showSupabaseSetup && (
          <div className="setup-bar">
            <div className="setup-group">
              <label>Supabase URL:</label>
              <input 
                type="text" 
                placeholder="https://xxx.supabase.co" 
                value={supabaseUrl} 
                onChange={(e) => setSupabaseUrl(e.target.value)} 
              />
            </div>
            <div className="setup-group">
              <label>API Key (anon):</label>
              <input 
                type="password" 
                placeholder="eyJ..." 
                value={supabaseKey} 
                onChange={(e) => setSupabaseKey(e.target.value)} 
              />
            </div>
            <button onClick={connectSupabase} className="btn btn-primary">연결</button>
          </div>
        )}

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
              {!isSupabaseConnected && (
                <p className="setup-hint">먼저 Supabase를 연결해주세요 ⬆️</p>
              )}
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
      <header className="header">
        <div className="header-left">
          <button className="btn btn-ghost" onClick={() => setView('home')}>← 홈</button>
          <h1>📚 AI 전자책 제작</h1>
          <div className="mode-tabs">
            <button className={`tab ${mode === 'ebook' ? 'active' : ''}`} onClick={() => setMode('ebook')}>전자책</button>
            <button className={`tab ${mode === 'simple' ? 'active' : ''}`} onClick={() => setMode('simple')}>문서</button>
          </div>
        </div>
        <div className="header-right">
          <span className="shortcut-hint">Ctrl+Z: 되돌리기</span>
          <button 
            className="btn btn-success" 
            onClick={saveCurrentProject} 
            disabled={pages.length === 0 || isSaving}
          >
            {isSaving ? '저장 중...' : '💾 저장'}
          </button>
          <button className="btn btn-ghost" onClick={() => setShowApiKey(!showApiKey)}>⚙️</button>
        </div>
      </header>

      {showApiKey && (
        <div className="api-bar">
          <div className="api-input-group">
            <label>Claude API 키:</label>
            <input type="password" placeholder="sk-ant-..." value={apiKey} onChange={(e) => setApiKey(e.target.value)} />
            <button onClick={saveApiKey} className="btn btn-primary">저장</button>
          </div>
        </div>
      )}

      {error && (
        <div className="error-bar">
          <span>⚠️ {error}</span>
          <button onClick={() => setError(null)}>✕</button>
        </div>
      )}

      <div className="main">
        <div className="input-section">
          <div className="section-block">
            <h2>📐 용지</h2>
            <div className="page-size-selector">
              {(Object.keys(PAGE_SIZES) as PageSize[]).map((size) => (
                <button key={size} className={`size-btn ${pageSize === size ? 'active' : ''}`} onClick={() => setPageSize(size)}>
                  {size}
                </button>
              ))}
            </div>
          </div>

          {mode === 'ebook' && (
            <div className="section-block">
              <h2>📖 책 정보</h2>
              <div className="form-group">
                <label>제목</label>
                <input type="text" placeholder="AI 시대에서 살아남는 방법" value={bookTitle} onChange={(e) => setBookTitle(e.target.value)} />
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>챕터</label>
                  <input type="text" placeholder="서론, 본론, 결론" value={chapters} onChange={(e) => setChapters(e.target.value)} />
                </div>
                <div className="form-group small">
                  <label>페이지</label>
                  <input type="number" min="1" max="50" value={pageCount} onChange={(e) => setPageCount(e.target.value)} />
                </div>
              </div>
            </div>
          )}

          <div className="section-block flex-grow">
            <h2>✍️ 내용</h2>
            <textarea placeholder="책에서 다룰 주제를 입력하세요..." value={prompt} onChange={(e) => setPrompt(e.target.value)} />
          </div>

          <div className="action-bar">
            <button onClick={generateContent} disabled={isLoading} className="btn btn-primary btn-large">
              {isLoading ? (<><span className="spinner-small"></span>생성 중...</>) : '✨ AI로 작성'}
            </button>
            <div className="action-row">
              <button onClick={downloadPdf} disabled={pages.length === 0} className="btn btn-success">📥 PDF</button>
              <button onClick={() => setIsEditing(!isEditing)} disabled={pages.length === 0} className={`btn ${isEditing ? 'btn-warning' : 'btn-secondary'}`}>
                {isEditing ? '✓ 완료' : '✏️ 편집'}
              </button>
            </div>
          </div>
        </div>

        <div className="preview-section">
          {isEditing && (
            <div className="edit-toolbar">
              <div className="toolbar-group">
                <button onClick={() => handleAlign('left')} className="tool-btn">◀</button>
                <button onClick={() => handleAlign('center')} className="tool-btn">●</button>
                <button onClick={() => handleAlign('right')} className="tool-btn">▶</button>
              </div>
              <div className="toolbar-group">
                <button onClick={handleAddImage} className="tool-btn">🖼️</button>
                <button onClick={handleRotate} disabled={!selectedBlock || selectedBlock.type !== 'image'} className="tool-btn">🔄</button>
              </div>
              <div className="toolbar-group">
                <button onClick={handleDeleteBlock} disabled={!selectedBlockId} className="tool-btn danger">🗑️</button>
              </div>
            </div>
          )}

          {pages.length > 0 && (
            <div className="page-nav-center">
              <button onClick={() => setCurrentPageIndex(Math.max(0, currentPageIndex - 1))} disabled={currentPageIndex === 0}>◀</button>
              <span>{currentPageIndex + 1} / {pages.length}</span>
              <button onClick={() => setCurrentPageIndex(Math.min(pages.length - 1, currentPageIndex + 1))} disabled={currentPageIndex >= pages.length - 1}>▶</button>
            </div>
          )}

          <div className="preview-container">
            {pages.length > 0 && currentPage ? (
              <div
                ref={pageRef}
                className={`book-page ${isEditing ? 'editing' : ''}`}
                style={{ width: previewSize.width, height: previewSize.height }}
                onClick={handlePageClick}
                onMouseMove={handleMouseMove}
                onMouseUp={handleMouseUp}
                onMouseLeave={handleMouseUp}
              >
                {currentPage.blocks.map(block => (
                  <div
                    key={block.id}
                    className={`block ${block.type} ${selectedBlockId === block.id ? 'selected' : ''} ${isEditing ? 'editable' : ''}`}
                    style={{
                      left: block.x,
                      top: block.y,
                      width: block.width,
                      fontSize: block.style?.fontSize,
                      fontWeight: block.style?.fontWeight,
                      color: block.style?.color,
                      textAlign: block.style?.textAlign,
                      background: block.style?.background,
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
                        onBlur={handleTextEditComplete}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') handleTextEditComplete()
                          if (e.ctrlKey && e.key === 'a') {
                            e.preventDefault()
                            ;(e.target as HTMLInputElement).select()
                          }
                        }}
                        autoFocus
                      />
                    ) : block.type === 'image' ? (
                      <>
                        <img src={block.content} alt="" style={{ width: '100%', transform: block.rotation ? `rotate(${block.rotation}deg)` : undefined }} />
                        {isEditing && selectedBlockId === block.id && (
                          <div className="resize-handle" onMouseDown={(e) => handleResizeStart(e, block)} />
                        )}
                      </>
                    ) : block.type === 'quote' ? (
                      <div className="quote-content">💡 {block.content}</div>
                    ) : block.type === 'list' ? (
                      <div className="list-content">{block.content.startsWith('-') ? '✓ ' : ''}{block.content.replace(/^-\s*/, '').replace(/^\d+\.\s*/, '')}</div>
                    ) : (
                      <span dangerouslySetInnerHTML={{ __html: block.content.replace(/\*\*(.+?)\*\*/g, '<strong style="color:#dc2626">$1</strong>') }} />
                    )}
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
                      transform: block.rotation ? `rotate(${block.rotation}deg)` : undefined,
                    }}
                  >
                    {block.type === 'image' ? (
                      <img src={block.content} alt="" style={{ width: '100%' }} />
                    ) : block.type === 'quote' ? (
                      <div className="quote-content">💡 {block.content}</div>
                    ) : block.type === 'list' ? (
                      <div className="list-content">{block.content.startsWith('-') ? '✓ ' : ''}{block.content.replace(/^-\s*/, '').replace(/^\d+\.\s*/, '')}</div>
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
