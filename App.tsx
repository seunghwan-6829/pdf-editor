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
    borderBottom?: string
    border?: string
    borderRadius?: string
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

// 챕터 헤딩 스타일 (프리미엄 레이아웃)
const CHAPTER_STYLES = [
  // 스타일 1: 클래식 네이비
  { background: 'linear-gradient(135deg, #1e3a5f, #2d5a87)', color: '#fff', borderRadius: '6px' },
  // 스타일 2: 모던 그레이 + 골드 악센트
  { background: '#f8f9fa', color: '#2d3748', borderLeft: '5px solid #d4af37', borderRadius: '0' },
  // 스타일 3: 미니멀 언더라인
  { background: 'transparent', color: '#1a202c', borderBottom: '2px solid #2d3748', borderRadius: '0' },
  // 스타일 4: 소프트 그라데이션
  { background: 'linear-gradient(135deg, #e8f4f8, #d1e8f0)', color: '#1e3a5f', borderRadius: '6px' },
]

// 콜아웃 스타일 (다양한 베리에이션)
const CALLOUT_STYLES: Record<string, { bg: string; border: string; color: string; icon: string }> = {
  tip: { bg: 'linear-gradient(135deg, #fffbeb, #fef3c7)', border: '#d97706', color: '#92400e', icon: '💡' },
  important: { bg: 'linear-gradient(135deg, #fef2f2, #fecaca)', border: '#dc2626', color: '#991b1b', icon: '❗' },
  example: { bg: 'linear-gradient(135deg, #f0fdf4, #dcfce7)', border: '#16a34a', color: '#166534', icon: '📌' },
  data: { bg: 'linear-gradient(135deg, #eff6ff, #dbeafe)', border: '#2563eb', color: '#1e40af', icon: '📊' },
  note: { bg: 'linear-gradient(135deg, #faf5ff, #f3e8ff)', border: '#9333ea', color: '#7c3aed', icon: '📝' },
}

// 소제목 스타일
const SUBHEADING_STYLES = [
  { color: '#be123c', borderLeft: '3px solid #be123c' },
  { color: '#0369a1', borderLeft: '3px solid #0369a1' },
  { color: '#7c3aed', borderLeft: '3px solid #7c3aed' },
  { color: '#059669', borderLeft: '3px solid #059669' },
]

let blockIdCounter = 0
const generateId = () => `block-${++blockIdCounter}`
const generateProjectId = () => `project-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`

export default function App() {
  const [view, setView] = useState<View>('home')
  const [projects, setProjects] = useState<Project[]>([])
  const [currentProjectId, setCurrentProjectId] = useState<string | null>(null)
  const [isLoadingProjects, setIsLoadingProjects] = useState(false)
  const [isSupabaseConnected, setIsSupabaseConnected] = useState(false)
  const [theme, setTheme] = useState<'dark' | 'light'>(() => 
    (localStorage.getItem('theme') as 'dark' | 'light') || 'dark'
  )
  
  const [mode, setMode] = useState<Mode>('ebook')
  const [apiKey, setApiKey] = useState(() => localStorage.getItem('claude_api_key') || '')
  const [pageSize, setPageSize] = useState<PageSize>('A4')
  const [prompt, setPrompt] = useState('')
  const [bookTitle, setBookTitle] = useState('')
  const [chapters, setChapters] = useState('')
  
  // 목차 구조
  const [tocItems, setTocItems] = useState<{id: string; title: string; subItems: {id: string; title: string}[]}[]>([
    { id: 'ch-1', title: '', subItems: [{ id: 'sub-1-1', title: '' }] }
  ])
  const [pageCount, setPageCount] = useState('5')
  const [isLoading, setIsLoading] = useState(false)
  const [generationProgress, setGenerationProgress] = useState({ current: 0, total: 0, chapterName: '' })
  const [error, setError] = useState<string | null>(null)
  const [showApiKey, setShowApiKey] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  
  const [pages, setPages] = useState<Page[]>([])
  const [currentPageIndex, setCurrentPageIndex] = useState(0)
  const [selectedBlockIds, setSelectedBlockIds] = useState<string[]>([])
  const [isEditing, setIsEditing] = useState(false)
  const [isDragging, setIsDragging] = useState(false)
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 })
  const [dragBlockId, setDragBlockId] = useState<string | null>(null)  // 드래그 시작한 블록
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

  // 테마 적용
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    localStorage.setItem('theme', theme)
  }, [theme])

  const toggleTheme = () => setTheme(prev => prev === 'dark' ? 'light' : 'dark')

  // 목차 관리 함수들
  const addChapter = () => {
    const newId = `ch-${Date.now()}`
    setTocItems(prev => [...prev, { id: newId, title: '', subItems: [{ id: `sub-${newId}-1`, title: '' }] }])
  }

  const removeChapter = (chapterId: string) => {
    if (tocItems.length <= 1) return
    setTocItems(prev => prev.filter(ch => ch.id !== chapterId))
  }

  const updateChapterTitle = (chapterId: string, title: string) => {
    setTocItems(prev => prev.map(ch => ch.id === chapterId ? { ...ch, title } : ch))
  }

  const addSubItem = (chapterId: string) => {
    setTocItems(prev => prev.map(ch => {
      if (ch.id !== chapterId) return ch
      const newSubId = `sub-${chapterId}-${Date.now()}`
      return { ...ch, subItems: [...ch.subItems, { id: newSubId, title: '' }] }
    }))
  }

  const removeSubItem = (chapterId: string, subId: string) => {
    setTocItems(prev => prev.map(ch => {
      if (ch.id !== chapterId) return ch
      if (ch.subItems.length <= 1) return ch
      return { ...ch, subItems: ch.subItems.filter(s => s.id !== subId) }
    }))
  }

  const updateSubItemTitle = (chapterId: string, subId: string, title: string) => {
    setTocItems(prev => prev.map(ch => {
      if (ch.id !== chapterId) return ch
      return { ...ch, subItems: ch.subItems.map(s => s.id === subId ? { ...s, title } : s) }
    }))
  }

  // 목차를 텍스트로 변환
  const getTocText = () => {
    return tocItems
      .filter(ch => ch.title.trim())
      .map((ch, i) => {
        const subs = ch.subItems
          .filter(s => s.title.trim())
          .map((s, j) => `  ${i + 1}.${j + 1} ${s.title}`)
          .join('\n')
        return `${i + 1}. ${ch.title}${subs ? '\n' + subs : ''}`
      })
      .join('\n')
  }

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

  // 미리보기 영역 포커스 상태
  const [isPreviewFocused, setIsPreviewFocused] = useState(false)

  // 미리보기 영역 Ctrl+Z / Ctrl+Y 핸들러
  const handlePreviewKeyDown = (e: React.KeyboardEvent) => {
    // 텍스트 입력 중이면 무시
    if (editingBlockId) return
    
    if (e.ctrlKey && e.key === 'z') {
      e.preventDefault()
      e.stopPropagation()
      if (historyIndex > 0) {
        const newIndex = historyIndex - 1
        setHistoryIndex(newIndex)
        setPages(JSON.parse(JSON.stringify(history[newIndex])))
      }
    }
    if (e.ctrlKey && e.key === 'y') {
      e.preventDefault()
      e.stopPropagation()
      if (historyIndex < history.length - 1) {
        const newIndex = historyIndex + 1
        setHistoryIndex(newIndex)
        setPages(JSON.parse(JSON.stringify(history[newIndex])))
      }
    }
  }

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

  // 분할 생성 (세부목차 단위로 각각 API 호출)
  const generateByChapters = async () => {
    const validChapters = tocItems.filter(ch => ch.title.trim())
    
    if (validChapters.length === 0) {
      setError('목차를 먼저 입력해주세요')
      return
    }
    if (!apiKey.trim()) {
      setError('API 키를 입력해주세요')
      setShowApiKey(true)
      return
    }
    if (!bookTitle.trim()) {
      setError('책 제목을 입력해주세요')
      return
    }

    // 총 생성할 항목 수 계산 (세부목차가 있으면 세부목차 개수, 없으면 챕터 1개)
    let totalItems = 0
    const generationPlan: { chapterIdx: number; chapterTitle: string; subIdx?: number; subTitle?: string }[] = []
    
    validChapters.forEach((chapter, chIdx) => {
      const validSubs = chapter.subItems.filter(s => s.title.trim())
      if (validSubs.length > 0) {
        validSubs.forEach((sub, sIdx) => {
          generationPlan.push({ 
            chapterIdx: chIdx, 
            chapterTitle: chapter.title, 
            subIdx: sIdx, 
            subTitle: sub.title 
          })
          totalItems++
        })
      } else {
        generationPlan.push({ chapterIdx: chIdx, chapterTitle: chapter.title })
        totalItems++
      }
    })

    setIsLoading(true)
    setError(null)
    setPages([])
    setCurrentPageIndex(0)
    setHistory([])
    setHistoryIndex(-1)
    setGenerationProgress({ current: 0, total: totalItems, chapterName: '' })

    let allContent = ''
    let currentChapterIdx = -1

    try {
      for (let i = 0; i < generationPlan.length; i++) {
        const item = generationPlan[i]
        const isNewChapter = item.chapterIdx !== currentChapterIdx
        currentChapterIdx = item.chapterIdx

        const displayName = item.subTitle 
          ? `${item.chapterIdx + 1}장 - ${item.subTitle}` 
          : `${item.chapterIdx + 1}장: ${item.chapterTitle}`
        
        setGenerationProgress({ 
          current: i + 1, 
          total: totalItems, 
          chapterName: displayName 
        })

        let sectionPrompt = ''
        
        if (item.subTitle) {
          // 세부목차 단위 생성
          sectionPrompt = `${isNewChapter && i === 0 ? `# ${bookTitle}\n\n` : ''}${isNewChapter ? `## ${item.chapterIdx + 1}장: ${item.chapterTitle}\n\n` : ''}### ${item.chapterIdx + 1}.${(item.subIdx || 0) + 1} ${item.subTitle}

【작성 규칙 - 이 세부목차를 최소 10페이지 분량으로 상세히 작성】
- 5-8개 이상의 문단으로 깊이 있게 작성
- 각 문단은 최소 4-5문장으로 구성
- 구체적인 예시, 실제 사례, 데이터 수치 반드시 포함
- > 콜아웃으로 핵심 포인트, 팁, 중요사항, 예시, 통계 등 표시
- **굵게**로 키워드 강조
- 적절한 위치에 [IMAGE: 설명] 형태로 이미지 위치 표시 (2-3개)
- 목록(-)으로 세부 정보 정리
- 문단 사이 빈 줄로 구분

【금지】코드블록, 표, 구분선, 짧은 요약

주제: ${prompt}

이 세부목차 "${item.subTitle}"에 대해 전문가 수준으로 깊이 있게 작성해주세요. 독자가 실제로 적용할 수 있는 구체적인 내용으로 채워주세요.`
        } else {
          // 세부목차 없는 챕터 전체 생성
          sectionPrompt = `${i === 0 ? `# ${bookTitle}\n\n` : ''}## ${item.chapterIdx + 1}장: ${item.chapterTitle}

【작성 규칙 - 이 챕터를 최소 15페이지 분량으로 상세히 작성】
- 8-12개 이상의 문단으로 깊이 있게 작성
- 각 문단은 최소 4-5문장으로 구성
- 구체적인 예시, 실제 사례, 데이터 수치 반드시 포함
- > 콜아웃으로 핵심 포인트, 팁, 중요사항, 예시, 통계 등 표시
- **굵게**로 키워드 강조
- 적절한 위치에 [IMAGE: 설명] 형태로 이미지 위치 표시 (3-5개)
- 목록(-)으로 세부 정보 정리
- 문단 사이 빈 줄로 구분

【금지】코드블록, 표, 구분선, 짧은 요약

주제: ${prompt}

이 챕터 "${item.chapterTitle}"에 대해 전문가 수준으로 깊이 있게 작성해주세요.`
        }

        // 스트리밍 호출
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
            max_tokens: 16000,
            stream: true,
            system: '프리미엄 전자책 전문 작가입니다. 독자에게 실질적 가치를 주는 깊이 있고 풍부한 콘텐츠를 작성합니다. 절대 요약하지 않고, 각 주제를 철저히 다룹니다.',
            messages: [{ role: 'user', content: sectionPrompt }],
          }),
        })

        if (!response.ok) throw new Error('API 오류')

        const reader = response.body?.getReader()
        if (!reader) throw new Error('스트리밍 실패')

        const decoder = new TextDecoder()
        let sectionContent = ''

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
                  sectionContent += parsed.delta.text
                  // 실시간 업데이트
                  const newPages = parseMarkdownToPages(allContent + (allContent ? '\n\n' : '') + sectionContent, previewSize)
                  setPages(newPages)
                }
              } catch {}
            }
          }
        }

        allContent += (allContent ? '\n\n' : '') + sectionContent
      }

      // 완료 후 히스토리 저장
      const finalPages = parseMarkdownToPages(allContent, previewSize)
      saveToHistory(finalPages)

    } catch (e) {
      setError(e instanceof Error ? e.message : 'API 호출 실패')
    } finally {
      setIsLoading(false)
      setGenerationProgress({ current: 0, total: 0, chapterName: '' })
    }
  }

  // AI 콘텐츠 생성 (기존 - 한번에)
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

    let userPrompt = prompt

    if (mode === 'ebook' && bookTitle) {
      const tocText = getTocText()
      
      userPrompt = `프리미엄 전자책을 작성해주세요. 베스트셀러 수준의 퀄리티와 깊이로 작성합니다.

【책 정보】
제목: ${bookTitle}
분량: 약 ${pageCount}페이지 (각 페이지에 충분한 내용)
주제: ${prompt}

${tocText ? `【목차 구조 - 이 순서대로 작성】
${tocText}

위 목차의 각 항목을 순서대로 상세하게 작성해주세요.` : (chapters ? `챕터 구성: ${chapters}` : '')}

【핵심 작성 원칙 - 매우 중요】
1. **풍부한 설명**: 모든 개념은 3-4문장 이상으로 상세히 설명
2. **구체적인 예시**: 추상적 설명 후 반드시 실제 예시 추가
3. **데이터/통계**: 신뢰성 있는 수치와 연구 결과 인용
4. **단계별 설명**: 방법론은 구체적인 스텝으로 분해
5. **독자 공감**: "~한 경험이 있으신가요?"처럼 독자 참여 유도

【콜아웃 활용 (> 기호 사용)】
- > 💡 팁: 실용적인 조언
- > 중요: 핵심 포인트 강조
- > 예시: 구체적인 사례
- > 데이터: 통계나 연구 결과
- > 참고: 추가 정보

【문단 구성】
- 서론: 왜 이 주제가 중요한지 (독자의 문제점 공감)
- 본론: 해결책을 상세히 설명 (예시, 데이터 포함)
- 결론: 핵심 요약 + 실천 방안

【형식】
- # 책 제목 (맨 처음 한 번)
- ## 챕터 제목
- ### 소제목
- > 콜아웃 박스
- **굵게** 키워드 강조
- 목록 - 또는 1. 2. 3.

【절대 금지】
- 코드 블록, 구분선, 표 사용 금지
- 한 줄짜리 짧은 문장만으로 구성 금지
- "페이지" 언급 금지

【분량 기준】
- 각 소제목(###) 아래 최소 3-5개 문단
- 각 문단은 2-4문장으로 구성
- 콜아웃은 챕터당 2-3개 적절히 배치

깊이 있고 가치 있는 콘텐츠를 작성해주세요.`
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
          max_tokens: 16000,
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
    // 스타일 인덱스
    let chapterIdx = 0
    let subheadingIdx = 0
    
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
          // 문단 끝이면 더 큰 간격
          y += (lastBlockType === 'text') ? 12 : 8
          lastWasEmpty = true
        }
        continue
      }
      lastWasEmpty = false
      
      let blockHeight = 18
      let marginTop = 4
      let block: Block | null = null
      
      if (trimmed.startsWith('# ')) {
        // 책 제목: 프리미엄 네이비 스타일
        blockHeight = 55
        marginTop = lastBlockType ? 12 : 0
        block = {
          id: generateId(), type: 'heading', content: trimmed.slice(2),
          x, y: y + marginTop, width: contentWidth,
          style: { 
            fontSize: 22, fontWeight: 'bold', textAlign: 'center', 
            background: 'linear-gradient(135deg, #1e3a5f, #34495e)', 
            color: '#fff', 
            padding: '16px 20px',
            borderRadius: '8px'
          }
        }
        lastBlockType = 'h1'
      } else if (trimmed.startsWith('## ')) {
        // 챕터 제목: 다양한 레이아웃 스타일
        blockHeight = 34
        marginTop = lastBlockType === 'h1' ? 10 : 14
        const style = CHAPTER_STYLES[chapterIdx % CHAPTER_STYLES.length]
        chapterIdx++
        block = {
          id: generateId(), type: 'heading', content: trimmed.slice(3),
          x, y: y + marginTop, width: contentWidth,
          style: { fontSize: 14, fontWeight: 'bold', ...style, padding: '10px 14px' }
        }
        lastBlockType = 'h2'
      } else if (trimmed.startsWith('### ')) {
        // 소제목: 다양한 색상
        blockHeight = 24
        marginTop = 10
        const subStyle = SUBHEADING_STYLES[subheadingIdx % SUBHEADING_STYLES.length]
        subheadingIdx++
        block = {
          id: generateId(), type: 'heading', content: trimmed.slice(4),
          x, y: y + marginTop, width: contentWidth,
          style: { 
            fontSize: 11, fontWeight: '600', 
            ...subStyle,
            background: 'transparent',
            padding: '4px 10px', 
          }
        }
        lastBlockType = 'h3'
      } else if (trimmed.startsWith('> ')) {
        // 콜아웃: 내용에 따라 다른 스타일
        const content = trimmed.slice(2)
        const contentLower = content.toLowerCase()
        
        let calloutType = 'tip' // 기본값
        if (contentLower.includes('중요') || contentLower.includes('주의') || contentLower.includes('경고')) {
          calloutType = 'important'
        } else if (contentLower.includes('예시') || contentLower.includes('사례') || contentLower.includes('예를 들')) {
          calloutType = 'example'
        } else if (contentLower.includes('데이터') || contentLower.includes('통계') || contentLower.includes('연구') || contentLower.includes('%')) {
          calloutType = 'data'
        } else if (contentLower.includes('참고') || contentLower.includes('노트') || contentLower.includes('메모')) {
          calloutType = 'note'
        }
        
        const style = CALLOUT_STYLES[calloutType]
        const lines = Math.ceil(content.length / 45)
        blockHeight = 28 + (lines > 1 ? (lines - 1) * 14 : 0)
        marginTop = 8
        
        block = {
          id: generateId(), type: 'quote', content: `${style.icon} ${content}`,
          x, y: y + marginTop, width: contentWidth,
          style: { 
            background: style.bg, 
            borderLeft: `4px solid ${style.border}`,
            color: style.color,
            padding: '12px 14px',
            borderRadius: '6px'
          }
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
      } else if (trimmed.startsWith('[IMAGE:') || trimmed.startsWith('[이미지:')) {
        // 이미지 placeholder
        const desc = trimmed.replace(/\[IMAGE:|이미지:|\]/gi, '').trim()
        blockHeight = 80
        marginTop = 10
        block = {
          id: generateId(), type: 'image', content: `📷 이미지 영역\n${desc}`,
          x: x + 20, y: y + marginTop, width: contentWidth - 40,
          style: { 
            background: '#f1f5f9', 
            border: '2px dashed #94a3b8',
            borderRadius: '8px',
            padding: '20px',
            textAlign: 'center',
            color: '#64748b'
          }
        }
        lastBlockType = 'image'
      } else if (trimmed.startsWith('|')) {
        // 테이블 행 -> 리스트 형태로 변환
        if (trimmed.includes('---')) continue
        
        const cells = trimmed.split('|').filter(c => c.trim())
        if (cells.length === 0) continue
        
        const content = cells.map(c => c.trim()).join(' • ')
        blockHeight = 16
        marginTop = lastBlockType === 'table' ? 2 : 6
        block = {
          id: generateId(), type: 'list', content: `📌 ${content}`,
          x, y: y + marginTop, width: contentWidth,
          style: { background: '#f8fafc', padding: '4px 8px', borderRadius: '4px' }
        }
        lastBlockType = 'table'
      } else {
        blockHeight = 16 + Math.floor(trimmed.length / 50) * 14
        marginTop = lastBlockType === 'text' ? 4 : 6
        block = {
          id: generateId(), type: 'text', content: trimmed,
          x, y: y + marginTop, width: contentWidth,
          style: { color: '#2d3748' }
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
    e.stopPropagation()
    
    // 선택되지 않은 블록 클릭 시 해당 블록만 선택
    if (!selectedBlockIds.includes(blockId)) {
      setSelectedBlockIds([blockId])
    }
    
    // 드래그 시작한 블록 기록
    setDragBlockId(blockId)
    setIsDragging(true)
    
    // 클릭한 블록 기준 오프셋
    if (block) {
      const rect = pageRef.current?.getBoundingClientRect()
      if (rect) {
        setDragOffset({ 
          x: e.clientX - rect.left - block.x, 
          y: e.clientY - rect.top - block.y 
        })
      }
    }
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
      
      // 선택 영역
      const selMinX = Math.min(selectionStart.x, mouseX)
      const selMaxX = Math.max(selectionStart.x, mouseX)
      const selMinY = Math.min(selectionStart.y, mouseY)
      const selMaxY = Math.max(selectionStart.y, mouseY)
      
      // 선택 영역이 충분히 큰 경우에만 선택 (최소 10px)
      if (Math.abs(selMaxX - selMinX) < 10 && Math.abs(selMaxY - selMinY) < 10) {
        return
      }
      
      // 선택 영역 내 블록 찾기
      const selected = currentPage?.blocks
        .filter(b => {
          if (b.locked) return false
          // 블록 높이 추정 (타입별)
          let blockHeight = 18
          if (b.type === 'heading') {
            blockHeight = b.style?.fontSize === 22 ? 50 : b.style?.fontSize === 14 ? 34 : 24
          } else if (b.type === 'quote') {
            blockHeight = 32
          } else if (b.type === 'list') {
            blockHeight = 16
          }
          
          // 블록 중심점이 선택 영역 안에 있는지 확인
          const blockCenterX = b.x + b.width / 2
          const blockCenterY = b.y + blockHeight / 2
          
          return blockCenterX >= selMinX && blockCenterX <= selMaxX && 
                 blockCenterY >= selMinY && blockCenterY <= selMaxY
        })
        .map(b => b.id) || []
      
      setSelectedBlockIds(selected)
      return
    }
    
    // 블록 드래그 (선택된 모든 블록 함께 이동)
    if (isDragging && selectedBlockIds.length > 0 && dragBlockId) {
      const draggedBlock = currentPage?.blocks.find(b => b.id === dragBlockId)
      if (!draggedBlock) return
      
      // 드래그 시작한 블록의 새 위치 계산
      let newX = mouseX - dragOffset.x
      let newY = mouseY - dragOffset.y
      
      // 스냅
      const snapped = getSnappedPosition(newX, newY, draggedBlock.width)
      
      // 이동량 계산
      const deltaX = snapped.x - draggedBlock.x
      const deltaY = snapped.y - draggedBlock.y
      
      // 모든 선택된 블록에 같은 이동량 적용
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
    setDragBlockId(null)
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

  // 새 페이지 추가
  const addNewPage = () => {
    const newPage: Page = {
      id: `page-${pages.length}`,
      blocks: []
    }
    updatePages(prev => [...prev, newPage])
    setCurrentPageIndex(pages.length)
  }

  // 페이지 삭제
  const deletePage = (idx: number) => {
    if (pages.length <= 1) return
    updatePages(prev => prev.filter((_, i) => i !== idx))
    if (currentPageIndex >= idx && currentPageIndex > 0) {
      setCurrentPageIndex(currentPageIndex - 1)
    }
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
            <button className="btn btn-ghost btn-sm" onClick={toggleTheme} title="테마 변경">
              {theme === 'dark' ? '☀️' : '🌙'}
            </button>
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
          <button className="btn btn-ghost btn-sm" onClick={toggleTheme} title="테마 변경">
            {theme === 'dark' ? '☀️' : '🌙'}
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
            <>
              <div className="section-block">
                <h3>📖 책 정보</h3>
                <input type="text" placeholder="책 제목" value={bookTitle} onChange={(e) => setBookTitle(e.target.value)} className="input-compact" />
                <input type="number" min="1" max="50" value={pageCount} onChange={(e) => setPageCount(e.target.value)} className="input-compact" placeholder="페이지 수" style={{marginTop: '0.5rem'}} />
              </div>
              
              <div className="section-block toc-section">
                <div className="toc-header">
                  <h3>📑 목차</h3>
                  <button onClick={addChapter} className="btn-mini-add" title="챕터 추가">+</button>
                </div>
                <div className="toc-list">
                  {tocItems.map((chapter, chIdx) => (
                    <div key={chapter.id} className="toc-chapter">
                      <div className="toc-chapter-row">
                        <span className="toc-num">{chIdx + 1}.</span>
                        <input 
                          type="text" 
                          placeholder={`챕터 ${chIdx + 1} 제목`}
                          value={chapter.title}
                          onChange={(e) => updateChapterTitle(chapter.id, e.target.value)}
                          className="toc-input"
                        />
                        {tocItems.length > 1 && (
                          <button onClick={() => removeChapter(chapter.id)} className="btn-mini-del">✕</button>
                        )}
                      </div>
                      <div className="toc-subitems">
                        {chapter.subItems.map((sub, subIdx) => (
                          <div key={sub.id} className="toc-subitem-row">
                            <span className="toc-subnum">{chIdx + 1}.{subIdx + 1}</span>
                            <input 
                              type="text" 
                              placeholder={`세부 ${subIdx + 1}`}
                              value={sub.title}
                              onChange={(e) => updateSubItemTitle(chapter.id, sub.id, e.target.value)}
                              className="toc-input-sub"
                            />
                            {chapter.subItems.length > 1 && (
                              <button onClick={() => removeSubItem(chapter.id, sub.id)} className="btn-mini-del">✕</button>
                            )}
                          </div>
                        ))}
                        <button onClick={() => addSubItem(chapter.id)} className="btn-add-sub">+ 세부목차</button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}

          <div className="section-block flex-grow">
            <h3>✍️ 내용</h3>
            <textarea placeholder="책에서 다룰 주제를 입력하세요..." value={prompt} onChange={(e) => setPrompt(e.target.value)} className="textarea-compact" />
          </div>

          <div className="generate-buttons">
            <button onClick={generateContent} disabled={isLoading} className="btn btn-primary btn-full">
              {isLoading && generationProgress.total === 0 ? (<><span className="spinner-small"></span>생성 중...</>) : '✨ 빠른 생성'}
            </button>
            <button 
              onClick={generateByChapters} 
              disabled={isLoading || tocItems.filter(ch => ch.title.trim()).length === 0} 
              className="btn btn-success btn-full"
              title="목차별로 나눠서 생성 (긴 콘텐츠용)"
            >
              {isLoading && generationProgress.total > 0 ? (
                <><span className="spinner-small"></span>{generationProgress.current}/{generationProgress.total} 생성 중</>
              ) : '📚 챕터별 생성'}
            </button>
          </div>
          {isLoading && generationProgress.chapterName && (
            <div className="progress-info">
              현재: {generationProgress.chapterName}
            </div>
          )}
        </div>

        <div 
          className={`preview-section ${isPreviewFocused ? 'focused' : ''}`} 
          ref={previewRef} 
          tabIndex={0}
          onKeyDown={handlePreviewKeyDown}
          onFocus={() => setIsPreviewFocused(true)}
          onBlur={(e) => {
            if (previewRef.current?.contains(e.relatedTarget as Node)) return
            setIsPreviewFocused(false)
          }}
          onClick={() => previewRef.current?.focus()}
        >
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
                      borderBottom: block.style?.borderBottom,
                      border: block.style?.border,
                      borderRadius: block.style?.borderRadius,
                      padding: block.style?.padding,
                      transform: block.rotation ? `rotate(${block.rotation}deg)` : undefined,
                    }}
                    onClick={(e) => handleBlockClick(e, block.id)}
                    onMouseDown={(e) => handleMouseDown(e, block.id)}
                    onDoubleClick={(e) => handleBlockDoubleClick(e, block)}
                  >
                    {editingBlockId === block.id ? (
                      <textarea
                        ref={textInputRef as React.RefObject<HTMLTextAreaElement>}
                        className="block-input block-textarea"
                        value={editingText}
                        onChange={(e) => setEditingText(e.target.value)}
                        onClick={handleTextInputClick}
                        onBlur={handleTextEditComplete}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && e.ctrlKey) handleTextEditComplete()
                          if (e.key === 'Escape') handleTextEditComplete()
                        }}
                        style={{
                          minHeight: Math.max(60, (editingText.split('\n').length + 1) * 18),
                        }}
                        autoFocus
                      />
                    ) : block.type === 'image' ? (
                      block.content.startsWith('📷') ? (
                        // 이미지 placeholder
                        <div className="image-placeholder">
                          {block.content.split('\n').map((line, i) => (
                            <div key={i}>{line}</div>
                          ))}
                        </div>
                      ) : (
                        <>
                          <img src={block.content} alt="" style={{ width: '100%' }} />
                          {isEditing && selectedBlockIds.includes(block.id) && !block.locked && (
                            <div className="resize-handle" onMouseDown={(e) => handleResizeStart(e, block)} />
                          )}
                        </>
                      )
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
                      borderBottom: block.style?.borderBottom,
                      border: block.style?.border,
                      borderRadius: block.style?.borderRadius,
                      padding: block.style?.padding,
                      transform: block.rotation ? `rotate(${block.rotation}deg)` : undefined,
                    }}
                  >
                    {block.type === 'image' ? (
                      block.content.startsWith('📷') ? (
                        <div className="image-placeholder">
                          {block.content.split('\n').map((line, i) => (
                            <div key={i}>{line}</div>
                          ))}
                        </div>
                      ) : (
                        <img src={block.content} alt="" style={{ width: '100%' }} />
                      )
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

        {/* 페이지 목록 사이드바 */}
        {pages.length > 0 && (
          <div className="pages-sidebar">
            <div className="sidebar-header">
              <span>페이지 ({pages.length})</span>
              <button onClick={addNewPage} className="btn-mini" title="새 페이지 추가">+</button>
            </div>
            <div className="pages-list">
              {pages.map((page, idx) => (
                <div 
                  key={page.id} 
                  className={`page-thumbnail ${idx === currentPageIndex ? 'active' : ''}`}
                  onClick={() => setCurrentPageIndex(idx)}
                >
                  <div className="thumbnail-preview" style={{ 
                    width: 80, 
                    height: 80 * (previewSize.height / previewSize.width) 
                  }}>
                    <div className="thumbnail-content">
                      {page.blocks.slice(0, 5).map(block => (
                        <div 
                          key={block.id} 
                          className="thumbnail-block"
                          style={{
                            left: `${(block.x / previewSize.width) * 100}%`,
                            top: `${(block.y / previewSize.height) * 100}%`,
                            width: `${(block.width / previewSize.width) * 100}%`,
                            height: block.type === 'heading' ? '8%' : '4%',
                            background: block.style?.background || (block.type === 'heading' ? '#6366f1' : '#ddd'),
                          }}
                        />
                      ))}
                    </div>
                    <span className="thumbnail-number">{idx + 1}</span>
                  </div>
                  {pages.length > 1 && (
                    <button 
                      className="thumbnail-delete" 
                      onClick={(e) => { e.stopPropagation(); deletePage(idx) }}
                      title="페이지 삭제"
                    >
                      ✕
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
