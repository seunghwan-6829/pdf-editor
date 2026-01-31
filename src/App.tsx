import React, { useState, useRef, useEffect, useCallback } from 'react'
import { generatePdfFromElement } from './pdf/pdfGenerator'
import { initSupabase, fetchProjects, saveProject, deleteProjectFromDB, ProjectRow } from './lib/supabase'
import './App.css'

// Supabase 설정 (자동 연결)
const SUPABASE_URL = 'https://ulklqfzfbxxjafhloxyz.supabase.co'
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVsa2xxZnpmYnh4amFmaGxveHl6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njk3Njc1NjcsImV4cCI6MjA4NTM0MzU2N30.ipTuZWVvZupYDD5qdOvbcpKHG6QTUGSMoWAZQAU-tQw'

type Mode = 'simple' | 'ebook'
type PageSize = 'A4' | 'A5' | 'B5'
type BlockType = 'text' | 'heading' | 'image' | 'list' | 'quote' | 'table' | 'step' | 'summary' | 'bigquote' | 'checklist' | 'highlight' | 'shape'
type View = 'home' | 'editor'

interface Block {
  id: string
  type: BlockType
  content: string
  x: number
  y: number
  width: number
  height?: number  // 도형용 높이
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
    numBg?: string
    numColor?: string
    fontStyle?: string
    // 도형 관련
    shapeType?: 'rect' | 'circle' | 'line'
    fill?: string
    stroke?: string
    strokeWidth?: number
    zIndex?: number
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

// 스텝 박스 스타일
const STEP_STYLES = [
  { numBg: '#3b82f6', numColor: '#fff', bg: '#eff6ff', border: '#3b82f6' },
  { numBg: '#8b5cf6', numColor: '#fff', bg: '#f5f3ff', border: '#8b5cf6' },
  { numBg: '#ec4899', numColor: '#fff', bg: '#fdf2f8', border: '#ec4899' },
  { numBg: '#14b8a6', numColor: '#fff', bg: '#f0fdfa', border: '#14b8a6' },
]

// 핵심 요약 박스 스타일
const SUMMARY_BOX_STYLE = {
  bg: 'linear-gradient(135deg, #1e293b, #334155)',
  color: '#f8fafc',
  border: '#3b82f6',
  icon: '🎯'
}

// 인용구 스타일
const QUOTE_BOX_STYLE = {
  bg: '#f8fafc',
  color: '#475569',
  border: '#94a3b8',
  quoteMark: '"'
}

// 체크리스트 스타일
const CHECKLIST_STYLE = {
  bg: '#f0fdf4',
  checkColor: '#16a34a',
  textColor: '#166534'
}

// 하이라이트 박스 스타일
const HIGHLIGHT_STYLES = [
  { bg: 'linear-gradient(90deg, #fef08a, #fde047)', color: '#713f12', icon: '⭐' },
  { bg: 'linear-gradient(90deg, #bbf7d0, #86efac)', color: '#166534', icon: '✨' },
  { bg: 'linear-gradient(90deg, #bfdbfe, #93c5fd)', color: '#1e40af', icon: '🔥' },
]

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
  const [isLoading, setIsLoading] = useState(false)
  const [generationProgress, setGenerationProgress] = useState({ current: 0, total: 0, chapterName: '' })
  const [error, setError] = useState<string | null>(null)
  const [showApiKey, setShowApiKey] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  
  // AI 수정 모달
  const [showAiEditModal, setShowAiEditModal] = useState(false)
  const [aiEditInstruction, setAiEditInstruction] = useState('')
  const [isAiEditing, setIsAiEditing] = useState(false)
  
  // PDF 다운로드 진행률
  const [pdfProgress, setPdfProgress] = useState({ current: 0, total: 0, status: '' })
  const [isDownloadingPdf, setIsDownloadingPdf] = useState(false)
  
  // 프롤로그, 목차, 에필로그 옵션
  const [includePrologue, setIncludePrologue] = useState(false)
  const [includeToc, setIncludeToc] = useState(false)
  const [includeEpilogue, setIncludeEpilogue] = useState(false)
  
  // 톤앤무드 설정
  const [bookTone, setBookTone] = useState('professional')  // professional, friendly, academic, casual
  
  // PDF 내보내기 페이지 범위
  const [exportRange, setExportRange] = useState({ start: 1, end: 1 })
  const [showExportModal, setShowExportModal] = useState(false)
  
  // 저장 여부 추적
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false)
  const [showExitConfirm, setShowExitConfirm] = useState(false)
  
  const [pages, setPages] = useState<Page[]>([])
  const [currentPageIndex, setCurrentPageIndex] = useState(0)
  const [selectedBlockIds, setSelectedBlockIds] = useState<string[]>([])
  const [isEditing, setIsEditing] = useState(false)
  const [isDragging, setIsDragging] = useState(false)
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 })
  const [dragBlockId, setDragBlockId] = useState<string | null>(null)  // 드래그 시작한 블록
  const [editingBlockId, setEditingBlockId] = useState<string | null>(null)
  const [clipboardBlocks, setClipboardBlocks] = useState<Block[]>([])  // 복사한 블록들
  const [editingText, setEditingText] = useState('')
  
  // 드래그 선택 박스 - 비활성화됨
  // const [isSelecting, setIsSelecting] = useState(false)
  // const [selectionStart, setSelectionStart] = useState({ x: 0, y: 0 })
  // const [selectionEnd, setSelectionEnd] = useState({ x: 0, y: 0 })
  
  // 블록 조작 중인지 (ref로 즉시 반영)
  const isBlockAction = useRef(false)
  
  // 히스토리 (미리보기 전용)
  const [history, setHistory] = useState<Page[][]>([])
  const [historyIndex, setHistoryIndex] = useState(-1)
  
  // 가이드라인
  const [guidelines, setGuidelines] = useState<Guideline[]>([])
  const [showGuidelineMenu, setShowGuidelineMenu] = useState(false)
  
  const [isResizing, setIsResizing] = useState(false)
  const [resizeStart, setResizeStart] = useState({ x: 0, y: 0, width: 0, height: 0 })
  const [resizeDirection, setResizeDirection] = useState<'corner' | 'right' | 'bottom'>('corner')
  
  const pageRef = useRef<HTMLDivElement>(null)
  const pagesContainerRef = useRef<HTMLDivElement>(null)
  const textInputRef = useRef<HTMLTextAreaElement>(null)
  const previewRef = useRef<HTMLDivElement>(null)

  // 테마 적용 (다크모드 고정)
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', 'dark')
  }, [])

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
    setHasUnsavedChanges(true)
  }, [historyIndex])

  // 미리보기 영역 포커스 상태
  const [isPreviewFocused, setIsPreviewFocused] = useState(false)

  // 미리보기 영역 Ctrl+Z / Ctrl+Y / Ctrl+C / Ctrl+V 핸들러
  const handlePreviewKeyDown = (e: React.KeyboardEvent) => {
    // 텍스트 입력 중이면 무시
    if (editingBlockId) return
    
    // Ctrl+Z: 실행 취소
    if (e.ctrlKey && e.key === 'z') {
      e.preventDefault()
      e.stopPropagation()
      if (historyIndex > 0) {
        const newIndex = historyIndex - 1
        setHistoryIndex(newIndex)
        setPages(JSON.parse(JSON.stringify(history[newIndex])))
      }
    }
    // Ctrl+Y: 다시 실행
    if (e.ctrlKey && e.key === 'y') {
      e.preventDefault()
      e.stopPropagation()
      if (historyIndex < history.length - 1) {
        const newIndex = historyIndex + 1
        setHistoryIndex(newIndex)
        setPages(JSON.parse(JSON.stringify(history[newIndex])))
      }
    }
    // Ctrl+C: 복사
    if (e.ctrlKey && e.key === 'c') {
      e.preventDefault()
      e.stopPropagation()
      if (selectedBlockIds.length > 0 && currentPage) {
        const blocksToCopy = currentPage.blocks.filter(b => selectedBlockIds.includes(b.id))
        if (blocksToCopy.length > 0) {
          setClipboardBlocks(JSON.parse(JSON.stringify(blocksToCopy)))
        }
      }
    }
    // Ctrl+V: 붙여넣기
    if (e.ctrlKey && e.key === 'v') {
      e.preventDefault()
      e.stopPropagation()
      if (clipboardBlocks.length > 0 && pages.length > 0) {
        isBlockAction.current = true
        
        const newBlockIds: string[] = []
        const newBlocks = clipboardBlocks.map(b => {
          const newId = generateId()
          newBlockIds.push(newId)
          return { ...b, id: newId }
        })
        
        const newPages = [...pages]
        newPages[currentPageIndex] = {
          ...newPages[currentPageIndex],
          blocks: [...newPages[currentPageIndex].blocks, ...newBlocks]
        }
        setPages(newPages)
        saveToHistory(newPages)
        
        // 새 블록만 선택 (딜레이 증가)
        requestAnimationFrame(() => {
          setSelectedBlockIds(newBlockIds)
          setTimeout(() => { isBlockAction.current = false }, 50)
        })
      }
    }
    // Delete: 선택한 블록 삭제
    if (e.key === 'Delete' || e.key === 'Backspace') {
      if (selectedBlockIds.length > 0 && currentPage) {
        e.preventDefault()
        e.stopPropagation()
        const newPages = [...pages]
        newPages[currentPageIndex] = {
          ...newPages[currentPageIndex],
          blocks: newPages[currentPageIndex].blocks.filter(b => !selectedBlockIds.includes(b.id))
        }
        setPages(newPages)
        saveToHistory(newPages)
        setSelectedBlockIds([])
      }
    }
  }

  // 텍스트 입력 시 전체선택
  useEffect(() => {
    if (editingBlockId && textInputRef.current) {
      textInputRef.current.select()
    }
  }, [editingBlockId])

  // 0번 페이지 숨김 - 페이지가 생성되면 자동으로 1번 페이지로 이동
  useEffect(() => {
    if (pages.length > 1 && currentPageIndex === 0) {
      setCurrentPageIndex(1)
    }
  }, [pages.length, currentPageIndex])

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
    setHasUnsavedChanges(false)
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
    setCurrentPageIndex(project.pages.length > 1 ? 1 : 0)  // 1페이지(인덱스0) 숨김
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
      // 프롤로그 생성
      if (includePrologue) {
        setGenerationProgress({ current: 0, total: totalItems, chapterName: '프롤로그 생성 중...' })
        const prologuePrompt = `"${bookTitle}" 전자책의 프롤로그를 작성해주세요.

【작성 규칙】
- 독자의 관심을 끄는 흥미로운 시작
- 이 책을 쓰게 된 이유와 배경
- 독자가 얻을 수 있는 가치
- 3-4개 문단으로 구성
- > 콜아웃으로 핵심 메시지 강조

주제: ${prompt}

## 프롤로그

`
        const prologueResponse = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
            'anthropic-dangerous-direct-browser-access': 'true',
          },
          body: JSON.stringify({
            model: 'claude-sonnet-4-20250514',
            max_tokens: 2000,
            messages: [{ role: 'user', content: prologuePrompt }],
          }),
        })
        if (prologueResponse.ok) {
          const data = await prologueResponse.json()
          allContent = `## 프롤로그\n\n${data.content[0].text}\n\n`
          const newPages = parseMarkdownToPages(allContent, previewSize)
          setPages(newPages)
        }
      }

      // 목차 페이지 생성
      if (includeToc) {
        const tocContent = `## 목차\n\n${validChapters.map((ch, i) => {
          const subs = ch.subItems.filter(s => s.title.trim())
          return `### ${i + 1}. ${ch.title}\n${subs.map((s, j) => `   ${i + 1}.${j + 1} ${s.title}`).join('\n')}`
        }).join('\n\n')}\n\n`
        allContent += tocContent
        const newPages = parseMarkdownToPages(allContent, previewSize)
        setPages(newPages)
      }

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
- **굵게**로 키워드 강조
- 문단 사이 빈 줄로 구분

【다양한 레이아웃 요소 적극 활용 - 매우 중요!】
- > 콜아웃 (3개 이상): 팁, 중요, 예시, 데이터, 참고 등
- [STEP 1] [STEP 2] [STEP 3] 형태로 단계별 설명 (방법론이나 과정 설명 시)
- [SUMMARY] 핵심 요약 박스 (섹션 끝에 요약)
- [QUOTE] 인상적인 인용구나 명언
- [x] 체크리스트 형태 (할 일 목록, 준비물 등)
- [HIGHLIGHT] 특별히 강조할 핵심 문장
- [IMAGE: 설명] 이미지 영역 (3-4개)
- --- 구분선 (섹션 구분 시)
- 목록(-) 활용

【금지】코드블록

주제: ${prompt}

이 세부목차 "${item.subTitle}"에 대해 다양한 레이아웃 요소를 활용해 시각적으로 풍부하게 작성해주세요!`
        } else {
          // 세부목차 없는 챕터 전체 생성
          sectionPrompt = `${i === 0 ? `# ${bookTitle}\n\n` : ''}## ${item.chapterIdx + 1}장: ${item.chapterTitle}

【작성 규칙 - 이 챕터를 최소 15페이지 분량으로 상세히 작성】
- 8-12개 이상의 문단으로 깊이 있게 작성
- 각 문단은 최소 4-5문장으로 구성
- 구체적인 예시, 실제 사례, 데이터 수치 반드시 포함
- **굵게**로 키워드 강조
- 문단 사이 빈 줄로 구분

【다양한 레이아웃 요소 적극 활용 - 매우 중요!】
- > 콜아웃 (5개 이상): 팁, 중요, 예시, 데이터, 참고 등
- [STEP 1] [STEP 2] [STEP 3] 형태로 단계별 설명
- [SUMMARY] 핵심 요약 박스 (각 섹션 끝에)
- [QUOTE] 인상적인 인용구나 명언
- [x] 체크리스트 형태
- [HIGHLIGHT] 특별히 강조할 핵심 문장
- [IMAGE: 설명] 이미지 영역 (5-7개)
- --- 구분선 (섹션 구분 시)
- 목록(-) 활용

【금지】코드블록

주제: ${prompt}

이 챕터 "${item.chapterTitle}"에 대해 다양한 레이아웃 요소를 활용해 시각적으로 풍부하게 작성해주세요!`
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

      // 에필로그 생성
      if (includeEpilogue) {
        setGenerationProgress({ current: totalItems, total: totalItems, chapterName: '에필로그 생성 중...' })
        const epiloguePrompt = `"${bookTitle}" 전자책의 에필로그를 작성해주세요.

【작성 규칙】
- 책의 핵심 내용 요약
- 독자에게 전하는 마지막 메시지
- 앞으로의 실천 방향 제시
- 감사 인사
- 3-4개 문단으로 구성
- > 콜아웃으로 핵심 메시지 강조

주제: ${prompt}

## 에필로그

`
        const epilogueResponse = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
            'anthropic-dangerous-direct-browser-access': 'true',
          },
          body: JSON.stringify({
            model: 'claude-sonnet-4-20250514',
            max_tokens: 2000,
            messages: [{ role: 'user', content: epiloguePrompt }],
          }),
        })
        if (epilogueResponse.ok) {
          const data = await epilogueResponse.json()
          allContent += `\n\n## 에필로그\n\n${data.content[0].text}`
          const newPages = parseMarkdownToPages(allContent, previewSize)
          setPages(newPages)
        }
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

  // 현재 페이지 블록들을 텍스트로 변환
  const pageBlocksToText = (blocks: Block[]): string => {
    return blocks.map(b => {
      if (b.type === 'heading') {
        const size = b.style?.fontSize
        if (size === 26) return `# ${b.content}`
        if (size === 17) return `## ${b.content}`
        return `### ${b.content}`
      }
      if (b.type === 'quote') return `> ${b.content}`
      if (b.type === 'list') return b.content
      if (b.type === 'step') return `[STEP ${b.content.split('|')[0].replace('STEP ', '')}] ${b.content.split('|')[1]}`
      if (b.type === 'summary') return `[SUMMARY] ${b.content.split('|')[1]}`
      if (b.type === 'bigquote') return `[QUOTE] ${b.content}`
      if (b.type === 'checklist') return `[x] ${b.content.replace('✅ ', '')}`
      if (b.type === 'highlight') return `[HIGHLIGHT] ${b.content}`
      if (b.type === 'image') return b.content.startsWith('📷') ? `[IMAGE: ${b.content.split('\n')[1] || ''}]` : ''
      return b.content.replace(/<[^>]*>/g, '')
    }).join('\n\n')
  }

  // AI 페이지 수정 (지시사항 기반)
  const aiEditCurrentPage = async () => {
    if (!apiKey.trim()) {
      setError('API 키를 입력해주세요')
      setShowApiKey(true)
      return
    }
    if (!currentPage || currentPage.blocks.length === 0) {
      setError('수정할 페이지가 없습니다')
      return
    }
    if (!aiEditInstruction.trim()) {
      setError('수정 지시사항을 입력해주세요')
      return
    }

    setIsAiEditing(true)
    setError(null)

    try {
      const currentContent = pageBlocksToText(currentPage.blocks)
      
      const editPrompt = `현재 페이지 내용:
---
${currentContent}
---

【수정 지시사항】
${aiEditInstruction}

【규칙】
- 위 지시사항에 따라 내용을 수정해주세요
- 기존 형식(마크다운)을 유지하세요
- > 콜아웃, [STEP N], [SUMMARY], [QUOTE], [x], [HIGHLIGHT], [IMAGE: 설명], --- 등 레이아웃 요소 활용
- 코드블록 금지

수정된 내용만 출력해주세요:`

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
          max_tokens: 4000,
          messages: [{ role: 'user', content: editPrompt }],
        }),
      })

      if (!response.ok) throw new Error('API 오류')
      
      const data = await response.json()
      const newContent = data.content[0].text
      
      // 새 콘텐츠를 블록으로 변환 (tempPages[0]은 더미, 실제 내용은 tempPages[1])
      const tempPages = parseMarkdownToPages(newContent, previewSize)
      if (tempPages.length > 1 && tempPages[1].blocks.length > 0) {
        const newPages = [...pages]
        newPages[currentPageIndex] = {
          ...newPages[currentPageIndex],
          blocks: tempPages[1].blocks
        }
        setPages(newPages)
        saveToHistory(newPages)
      }
      
      setShowAiEditModal(false)
      setAiEditInstruction('')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'AI 수정 실패')
    } finally {
      setIsAiEditing(false)
    }
  }

  // AI 페이지 재생성
  const aiRegeneratePage = async () => {
    if (!apiKey.trim()) {
      setError('API 키를 입력해주세요')
      setShowApiKey(true)
      return
    }
    if (!currentPage || currentPage.blocks.length === 0) {
      setError('재생성할 페이지가 없습니다')
      return
    }

    setIsAiEditing(true)
    setError(null)

    try {
      const currentContent = pageBlocksToText(currentPage.blocks)
      
      // 제목/주제 추출
      const headingBlock = currentPage.blocks.find(b => b.type === 'heading')
      const topic = headingBlock?.content || '이 섹션'
      
      const regenPrompt = `다음 내용의 주제를 유지하면서 완전히 새롭게 작성해주세요:

기존 주제: ${topic}
기존 내용 참고:
---
${currentContent.slice(0, 500)}...
---

【작성 규칙】
- 같은 주제로 더 풍부하고 새로운 관점으로 작성
- 5-8개 문단으로 상세히 작성
- > 콜아웃, [STEP N], [SUMMARY], [QUOTE], [x], [HIGHLIGHT], --- 등 다양한 레이아웃 요소 활용
- [IMAGE: 설명] 형태로 이미지 위치 2-3개 표시
- 코드블록 금지

새롭게 작성된 내용만 출력:`

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
          max_tokens: 8000,
          messages: [{ role: 'user', content: regenPrompt }],
        }),
      })

      if (!response.ok) throw new Error('API 오류')
      
      const data = await response.json()
      const newContent = data.content[0].text
      
      // 새 콘텐츠를 블록으로 변환 (tempPages[0]은 더미, 실제 내용은 tempPages[1])
      const tempPages = parseMarkdownToPages(newContent, previewSize)
      if (tempPages.length > 1 && tempPages[1].blocks.length > 0) {
        const newPages = [...pages]
        newPages[currentPageIndex] = {
          ...newPages[currentPageIndex],
          blocks: tempPages[1].blocks
        }
        setPages(newPages)
        saveToHistory(newPages)
      }
      
      setShowAiEditModal(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'AI 재생성 실패')
    } finally {
      setIsAiEditing(false)
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

【다양한 레이아웃 요소 필수 사용!】
- > 콜아웃: 팁, 중요, 예시, 데이터, 참고 (소제목당 2-3개)
- [STEP 1] [STEP 2] [STEP 3]: 단계별 설명 (방법론/과정에 사용)
- [SUMMARY] 핵심 요약: 섹션 끝에 요약 박스
- [QUOTE] 인용구: 인상적인 문장이나 명언
- [x] 체크리스트: 할 일, 준비물, 점검 항목
- [HIGHLIGHT] 하이라이트: 특별히 강조할 핵심
- [IMAGE: 설명] 이미지 영역 (챕터당 3-5개)
- --- 구분선: 섹션 구분
- 목록(-): 세부 정보 정리

【절대 금지】
- 코드 블록 사용 금지

【분량 기준】
- 각 소제목(###) 아래 4-6개 문단
- 문단 사이 빈 줄로 구분

다양한 레이아웃 요소를 적극 활용해 시각적으로 풍부한 콘텐츠를 작성해주세요!`
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
    
    // 0번 페이지는 더미 (프론트에서 숨김)
    const pages: Page[] = [{ id: generateId(), blocks: [] }]
    let currentBlocks: Block[] = []
    let y = startY
    let pageIdx = 1  // 1번 페이지부터 시작
    let lastWasEmpty = false
    let lastBlockType = ''
    
    for (const line of allLines) {
      const trimmed = line.trim()
      
      if (!trimmed) {
        if (!lastWasEmpty) {
          // 문단 끝이면 더 큰 간격
          y += (lastBlockType === 'text') ? 16 : 12
          lastWasEmpty = true
        }
        continue
      }
      lastWasEmpty = false
      
      let blockHeight = 22
      let marginTop = 6
      
      // 구분선 디자인
      if (trimmed === '---' || trimmed === '***' || trimmed === '___') {
        blockHeight = 20
        marginTop = 16
        
        if (y + marginTop + blockHeight > maxY) {
          pages.push({ id: generateId(), blocks: currentBlocks })
          currentBlocks = []
          y = startY
          pageIdx++
        }
        
        currentBlocks.push({
          id: generateId(), type: 'text', content: '',
          x: x + contentWidth * 0.1, y: y + marginTop, width: contentWidth * 0.8,
          style: {
            background: 'linear-gradient(90deg, transparent, #d1d5db, transparent)',
            borderRadius: '1px',
            padding: '1px 0',
          }
        })
        y += marginTop + blockHeight
        lastBlockType = 'divider'
        continue
      }
      let block: Block | null = null
      
      if (trimmed.startsWith('# ')) {
        // 책 제목: 프리미엄 네이비 스타일
        blockHeight = 66
        marginTop = lastBlockType ? 16 : 0
        block = {
          id: generateId(), type: 'heading', content: trimmed.slice(2),
          x, y: y + marginTop, width: contentWidth,
          style: { 
            fontSize: 26, fontWeight: 'bold', textAlign: 'center', 
            background: 'linear-gradient(135deg, #1e3a5f, #34495e)', 
            color: '#fff', 
            padding: '16px 20px',
            borderRadius: '8px'
          }
        }
        lastBlockType = 'h1'
      } else if (trimmed.startsWith('## ')) {
        // 챕터 제목: 다양한 레이아웃 스타일
        blockHeight = 42
        marginTop = lastBlockType === 'h1' ? 14 : 18
        const style = CHAPTER_STYLES[chapterIdx % CHAPTER_STYLES.length]
        chapterIdx++
        block = {
          id: generateId(), type: 'heading', content: trimmed.slice(3),
          x, y: y + marginTop, width: contentWidth,
          style: { fontSize: 17, fontWeight: 'bold', ...style, padding: '12px 16px' }
        }
        lastBlockType = 'h2'
      } else if (trimmed.startsWith('### ')) {
        // 소제목: 다양한 색상
        blockHeight = 30
        marginTop = 14
        const subStyle = SUBHEADING_STYLES[subheadingIdx % SUBHEADING_STYLES.length]
        subheadingIdx++
        block = {
          id: generateId(), type: 'heading', content: trimmed.slice(4),
          x, y: y + marginTop, width: contentWidth,
          style: { 
            fontSize: 13, fontWeight: '600', 
            ...subStyle,
            background: 'transparent',
            padding: '4px 10px', 
          }
        }
        lastBlockType = 'h3'
      } else if (/^\[STEP\s*(\d+)\]/i.test(trimmed)) {
        // 스텝 박스
        const match = trimmed.match(/^\[STEP\s*(\d+)\]\s*(.*)$/i)
        if (match) {
          const stepNum = parseInt(match[1])
          const content = match[2]
          const stepStyle = STEP_STYLES[(stepNum - 1) % STEP_STYLES.length]
          const lines = Math.ceil(content.length / 35)
          blockHeight = 44 + (lines > 1 ? (lines - 1) * 16 : 0)
          marginTop = 14
          
          block = {
            id: generateId(), type: 'step', content: `STEP ${stepNum}|${content}`,
            x, y: y + marginTop, width: contentWidth,
            style: {
              background: stepStyle.bg,
              border: `2px solid ${stepStyle.border}`,
              borderRadius: '10px',
              padding: '12px 14px 12px 50px',
              numBg: stepStyle.numBg,
              numColor: stepStyle.numColor,
            }
          }
          lastBlockType = 'step'
        }
      } else if (/^\[SUMMARY\]/i.test(trimmed)) {
        // 핵심 요약 박스
        const content = trimmed.replace(/^\[SUMMARY\]\s*/i, '')
        const lines = Math.ceil(content.length / 35)
        blockHeight = 50 + (lines > 1 ? (lines - 1) * 16 : 0)
        marginTop = 16
        
        block = {
          id: generateId(), type: 'summary', content: `${SUMMARY_BOX_STYLE.icon} 핵심 요약|${content}`,
          x, y: y + marginTop, width: contentWidth,
          style: {
            background: SUMMARY_BOX_STYLE.bg,
            color: SUMMARY_BOX_STYLE.color,
            borderLeft: `5px solid ${SUMMARY_BOX_STYLE.border}`,
            borderRadius: '8px',
            padding: '14px 16px',
          }
        }
        lastBlockType = 'summary'
      } else if (/^\[QUOTE\]/i.test(trimmed)) {
        // 인용구 박스 (큰따옴표)
        const content = trimmed.replace(/^\[QUOTE\]\s*/i, '')
        const lines = Math.ceil(content.length / 38)
        blockHeight = 50 + (lines > 1 ? (lines - 1) * 16 : 0)
        marginTop = 14
        
        block = {
          id: generateId(), type: 'bigquote', content,
          x, y: y + marginTop, width: contentWidth,
          style: {
            background: QUOTE_BOX_STYLE.bg,
            color: QUOTE_BOX_STYLE.color,
            borderLeft: `4px solid ${QUOTE_BOX_STYLE.border}`,
            borderRadius: '8px',
            padding: '16px 16px 16px 40px',
            fontStyle: 'italic',
          }
        }
        lastBlockType = 'bigquote'
      } else if (/^\[x\]/i.test(trimmed) || /^\[✓\]/.test(trimmed)) {
        // 체크리스트
        const content = trimmed.replace(/^\[x\]\s*|\[✓\]\s*/i, '')
        blockHeight = 24
        marginTop = lastBlockType === 'checklist' ? 4 : 10
        
        block = {
          id: generateId(), type: 'checklist', content: `✅ ${content}`,
          x, y: y + marginTop, width: contentWidth,
          style: {
            background: CHECKLIST_STYLE.bg,
            color: CHECKLIST_STYLE.textColor,
            padding: '6px 12px',
            borderRadius: '6px',
          }
        }
        lastBlockType = 'checklist'
      } else if (/^\[HIGHLIGHT\]/i.test(trimmed)) {
        // 하이라이트 박스
        const content = trimmed.replace(/^\[HIGHLIGHT\]\s*/i, '')
        const highlightStyle = HIGHLIGHT_STYLES[Math.floor(Math.random() * HIGHLIGHT_STYLES.length)]
        const lines = Math.ceil(content.length / 38)
        blockHeight = 36 + (lines > 1 ? (lines - 1) * 16 : 0)
        marginTop = 12
        
        block = {
          id: generateId(), type: 'highlight', content: `${highlightStyle.icon} ${content}`,
          x, y: y + marginTop, width: contentWidth,
          style: {
            background: highlightStyle.bg,
            color: highlightStyle.color,
            padding: '10px 14px',
            borderRadius: '20px',
            fontWeight: '600',
            textAlign: 'center',
          }
        }
        lastBlockType = 'highlight'
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
        const lines = Math.ceil(content.length / 40)
        blockHeight = 34 + (lines > 1 ? (lines - 1) * 16 : 0)
        marginTop = 12
        
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
        blockHeight = 20
        marginTop = lastBlockType === 'list' ? 4 : 8
        block = {
          id: generateId(), type: 'list', content: trimmed,
          x, y: y + marginTop, width: contentWidth,
        }
        lastBlockType = 'list'
      } else if (trimmed.startsWith('[IMAGE:') || trimmed.startsWith('[이미지:')) {
        // 이미지 placeholder
        const desc = trimmed.replace(/\[IMAGE:|이미지:|\]/gi, '').trim()
        blockHeight = 100
        marginTop = 14
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
        // 테이블 행 - 실제 그리드 테이블
        if (trimmed.includes('---') || trimmed.includes(':-')) continue  // 구분선 무시
        
        const cells = trimmed.split('|').filter(c => c.trim())
        if (cells.length === 0) continue
        
        const isHeader = lastBlockType !== 'table'
        const cellCount = cells.length
        blockHeight = isHeader ? 32 : 28
        marginTop = isHeader ? 14 : 0
        
        // HTML 테이블 행 생성
        const cellsHtml = cells.map(c => c.trim()).map((cell, i) => 
          `<span style="flex:1;padding:6px 10px;${i < cellCount - 1 ? 'border-right:1px solid #e2e8f0;' : ''}">${cell}</span>`
        ).join('')
        
        block = {
          id: generateId(), type: 'text', 
          content: cellsHtml,
          x, y: y + marginTop, width: contentWidth,
          style: { 
            background: isHeader ? '#f1f5f9' : '#ffffff', 
            border: isHeader ? '1px solid #e2e8f0' : '1px solid #e2e8f0',
            padding: '0',
            fontWeight: isHeader ? '600' : 'normal',
            fontSize: isHeader ? 13 : 12,
          }
        }
        lastBlockType = 'table'
      } else {
        blockHeight = 20 + Math.floor(trimmed.length / 45) * 16
        marginTop = lastBlockType === 'text' ? 6 : 10
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
    e.preventDefault()
    
    // 이미 다른 블록 조작 중이면 무시
    if (isBlockAction.current) return
    
    // 블록 조작 플래그 (즉시 반영!)
    isBlockAction.current = true
    
    // 드래그 상태 초기화
    setIsDragging(false)
    
    const block = currentPage?.blocks.find(b => b.id === blockId)
    if (block?.locked) {
      isBlockAction.current = false
      return
    }
    
    if (e.shiftKey) {
      // Shift+클릭: 다중 선택
      setSelectedBlockIds(prev => 
        prev.includes(blockId) ? prev.filter(id => id !== blockId) : [...prev, blockId]
      )
    } else {
      // 단일 선택 - 무조건 이 블록만!
      setSelectedBlockIds([blockId])
    }
    
    // 다음 틱에서 플래그 해제
    setTimeout(() => { isBlockAction.current = false }, 50)
  }

  // 블록 더블클릭
  const handleBlockDoubleClick = (e: React.MouseEvent, block: Block) => {
    if (!isEditing || block.type === 'image' || block.locked) return
    e.stopPropagation()
    setEditingBlockId(block.id)
    setEditingText(block.content)
  }

  // 텍스트 입력 클릭 (개별 선택)
  const handleTextInputClick = (e: React.MouseEvent<HTMLTextAreaElement>) => {
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
    
    // 이미 다른 블록 조작 중이면 무시
    if (isBlockAction.current) return
    
    const block = currentPage?.blocks.find(b => b.id === blockId)
    if (block?.locked) return
    
    e.preventDefault()
    e.stopPropagation()
    
    // 블록 조작 플래그 (즉시 반영!)
    isBlockAction.current = true
    
    // 이미 이 블록이 선택되어 있으면 선택 유지, 아니면 이 블록만 선택
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

  // 페이지 마우스 다운 - 빈 공간 클릭 시 선택 해제만
  const handlePageMouseDown = (e: React.MouseEvent) => {
    if (!isEditing) return
    
    // 이미 다른 블록 조작 중이면 무시
    if (isBlockAction.current) return
    
    const target = e.target as HTMLElement
    if (target.classList.contains('book-page')) {
      setSelectedBlockIds([])
    }
  }

  // 드래그 중 (블록 이동만)
  const handleMouseMove = (e: React.MouseEvent) => {
    if (!pageRef.current) return
    
    const rect = pageRef.current.getBoundingClientRect()
    const mouseX = e.clientX - rect.left
    const mouseY = e.clientY - rect.top
    
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
      const deltaX = e.clientX - resizeStart.x
      const deltaY = e.clientY - resizeStart.y
      
      setPages(prev => prev.map((page, idx) => {
        if (idx !== currentPageIndex) return page
        return {
          ...page,
          blocks: page.blocks.map(block => {
            if (block.id !== selectedBlockIds[0]) return block
            
            let newWidth = block.width
            let newHeight = block.height || 70
            
            if (resizeDirection === 'corner') {
              // 대각선: 가로/세로 동시 조절
              newWidth = Math.max(30, resizeStart.width + deltaX)
              newHeight = Math.max(30, resizeStart.height + deltaY)
            } else if (resizeDirection === 'right') {
              // 오른쪽: 가로만 조절
              newWidth = Math.max(30, resizeStart.width + deltaX)
            } else if (resizeDirection === 'bottom') {
              // 하단: 세로만 조절
              newHeight = Math.max(30, resizeStart.height + deltaY)
            }
            
            return { ...block, width: newWidth, height: newHeight }
          })
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
    setDragBlockId(null)
    isBlockAction.current = false
  }

  // 리사이즈 시작
  const handleResizeStart = (e: React.MouseEvent, block: Block, direction: 'corner' | 'right' | 'bottom' = 'corner') => {
    e.stopPropagation()
    e.preventDefault()
    isBlockAction.current = true  // 블록 조작 플래그
    setSelectedBlockIds([block.id])
    setIsResizing(true)
    setResizeDirection(direction)
    const height = block.height || (block.type === 'shape' ? 70 : 100)
    setResizeStart({ x: e.clientX, y: e.clientY, width: block.width, height })
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

  // 뒤로 보내기 (zIndex 기반)
  const sendToBack = () => {
    if (selectedBlockIds.length === 0 || !currentPage) return
    const minZIndex = currentPage.blocks.reduce((min, b) => Math.min(min, b.style?.zIndex || 0), 0)
    updatePages(prev => prev.map((page, idx) => {
      if (idx !== currentPageIndex) return page
      return {
        ...page,
        blocks: page.blocks.map(b => 
          selectedBlockIds.includes(b.id) 
            ? { ...b, style: { ...b.style, zIndex: minZIndex - 1 } }
            : b
        )
      }
    }))
  }

  // 앞으로 가져오기 (zIndex 기반)
  const bringToFront = () => {
    if (selectedBlockIds.length === 0 || !currentPage) return
    const maxZIndex = currentPage.blocks.reduce((max, b) => Math.max(max, b.style?.zIndex || 0), 0)
    updatePages(prev => prev.map((page, idx) => {
      if (idx !== currentPageIndex) return page
      return {
        ...page,
        blocks: page.blocks.map(b => 
          selectedBlockIds.includes(b.id) 
            ? { ...b, style: { ...b.style, zIndex: maxZIndex + 1 } }
            : b
        )
      }
    }))
  }

  // 블록 삭제
  const handleDeleteBlock = () => {
    if (selectedBlockIds.length === 0 || !currentPage) return
    const newPages = [...pages]
    newPages[currentPageIndex] = {
      ...newPages[currentPageIndex],
      blocks: newPages[currentPageIndex].blocks.filter(b => !selectedBlockIds.includes(b.id))
    }
    setPages(newPages)
    saveToHistory(newPages)
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

  // 페이지 사이에 삽입 (실제 인덱스 기준)
  const insertPageAt = (realIdx: number) => {
    const newPage: Page = {
      id: `page-${Date.now()}`,
      blocks: []
    }
    updatePages(prev => {
      const newPages = [...prev]
      newPages.splice(realIdx, 0, newPage)
      return newPages
    })
    setCurrentPageIndex(realIdx)
  }

  // 페이지 삭제
  const deletePage = (idx: number) => {
    if (pages.length <= 2) return  // 더미 + 최소 1페이지 유지
    updatePages(prev => prev.filter((_, i) => i !== idx))
    if (currentPageIndex >= idx && currentPageIndex > 1) {
      setCurrentPageIndex(currentPageIndex - 1)
    }
  }

  // PDF 내보내기 모달 열기
  const openExportModal = () => {
    setExportRange({ start: 1, end: pages.length - 1 })
    setShowExportModal(true)
  }

  // PDF 다운로드 (범위 선택)
  const downloadPdf = async (startPage?: number, endPage?: number) => {
    if (pages.length <= 1) return setError('먼저 내용을 생성해주세요')
    if (!pagesContainerRef.current) return setError('컨테이너 없음')
    
    const start = startPage || 1
    const end = endPage || (pages.length - 1)
    const rangeSize = end - start + 1
    
    setIsDownloadingPdf(true)
    setPdfProgress({ current: 0, total: rangeSize, status: '준비 중...' })
    setShowExportModal(false)
    
    try {
      await generatePdfFromElement(
        pagesContainerRef.current, 
        bookTitle || 'document', 
        pageSize,
        (current, total) => {
          setPdfProgress({ current, total, status: `${current}/${total} 페이지 변환 중...` })
        },
        start,
        end
      )
      setPdfProgress({ current: 0, total: 0, status: '' })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'PDF 생성 실패')
    } finally {
      setIsDownloadingPdf(false)
    }
  }

  const handlePageClick = () => {
    setSelectedBlockIds([])
  }

  const selectedBlock = selectedBlockIds.length === 1 
    ? currentPage?.blocks.find(b => b.id === selectedBlockIds[0]) 
    : null

  // 선택 박스 스타일 - 비활성화됨
  const selectionBoxStyle = null

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
          <button className="btn btn-ghost btn-sm" onClick={() => {
            if (hasUnsavedChanges && pages.length > 0) {
              setShowExitConfirm(true)
            } else {
              setView('home')
            }
          }}>← 홈</button>
          <h1>📚 {bookTitle || '새 프로젝트'}</h1>
          <div className="mode-tabs">
            <button className={`tab ${mode === 'ebook' ? 'active' : ''}`} onClick={() => setMode('ebook')}>전자책</button>
            <button className={`tab ${mode === 'simple' ? 'active' : ''}`} onClick={() => setMode('simple')}>문서</button>
          </div>
          {pages.length > 0 && (
            <button 
              className="btn btn-accent btn-sm" 
              onClick={() => setShowAiEditModal(true)}
              disabled={isLoading || isAiEditing}
            >
              ✨ AI 수정
            </button>
          )}
        </div>
        
        <div className="header-center">
          {/* 뒤로/앞으로 버튼 */}
          <div className="history-buttons">
            <button 
              onClick={() => {
                if (historyIndex > 0) {
                  const newIndex = historyIndex - 1
                  setHistoryIndex(newIndex)
                  setPages(JSON.parse(JSON.stringify(history[newIndex])))
                }
              }} 
              disabled={historyIndex <= 0}
              className="tool-btn"
              title="뒤로"
            >
              ↩️
            </button>
            <button 
              onClick={() => {
                if (historyIndex < history.length - 1) {
                  const newIndex = historyIndex + 1
                  setHistoryIndex(newIndex)
                  setPages(JSON.parse(JSON.stringify(history[newIndex])))
                }
              }}
              disabled={historyIndex >= history.length - 1}
              className="tool-btn"
              title="앞으로"
            >
              ↪️
            </button>
          </div>
          
          {/* 편집 도구 */}
          {isEditing && (
            <div className="toolbar-inline">
              <button onClick={() => handleAlign('left')} className="tool-btn" title="왼쪽 정렬">◀</button>
              <button onClick={() => handleAlign('center')} className="tool-btn" title="가운데 정렬">●</button>
              <button onClick={() => handleAlign('right')} className="tool-btn" title="오른쪽 정렬">▶</button>
              <span className="toolbar-divider" />
              <button onClick={handleAddImage} className="tool-btn" title="이미지 추가">🖼️</button>
              <button onClick={handleRotate} disabled={!selectedBlock || (selectedBlock.type !== 'image' && selectedBlock.type !== 'shape')} className="tool-btn" title="회전">🔄</button>
              <span className="toolbar-divider" />
              <button onClick={sendToBack} disabled={selectedBlockIds.length === 0} className="tool-btn" title="뒤로 보내기">⬇️</button>
              <button onClick={bringToFront} disabled={selectedBlockIds.length === 0} className="tool-btn" title="앞으로 가져오기">⬆️</button>
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
              {selectedBlock && ['shape', 'quote', 'step', 'summary', 'highlight', 'checklist', 'bigquote'].includes(selectedBlock.type) && (
                <>
                  <span className="toolbar-divider" />
                  <label className="color-picker-label">
                    배경
                    <input 
                      type="color" 
                      value={selectedBlock.style?.fill || selectedBlock.style?.background?.match(/#[0-9a-fA-F]{6}/)?.[0] || '#3b82f6'}
                      onChange={(e) => {
                        updatePages(prev => prev.map((page, idx) => {
                          if (idx !== currentPageIndex) return page
                          return {
                            ...page,
                            blocks: page.blocks.map(b => 
                              b.id === selectedBlock.id 
                                ? { ...b, style: { ...b.style, fill: e.target.value, background: e.target.value } }
                                : b
                            )
                          }
                        }))
                      }}
                      className="color-input"
                    />
                  </label>
                  <label className="color-picker-label">
                    테두리
                    <input 
                      type="color" 
                      value={selectedBlock.style?.stroke || selectedBlock.style?.borderLeft?.match(/#[0-9a-fA-F]{6}/)?.[0] || '#1d4ed8'}
                      onChange={(e) => {
                        updatePages(prev => prev.map((page, idx) => {
                          if (idx !== currentPageIndex) return page
                          return {
                            ...page,
                            blocks: page.blocks.map(b => 
                              b.id === selectedBlock.id 
                                ? { ...b, style: { ...b.style, stroke: e.target.value, borderLeft: `4px solid ${e.target.value}` } }
                                : b
                            )
                          }
                        }))
                      }}
                      className="color-input"
                    />
                  </label>
                </>
              )}
              <button onClick={handleDeleteBlock} disabled={selectedBlockIds.length === 0} className="tool-btn danger" title="삭제">🗑️</button>
            </div>
          )}
          
        </div>
        
        <div className="header-right">
          {/* 페이지 네비게이션 (0번 페이지 숨김) */}
          {pages.length > 1 && (
            <div className="page-nav-inline">
              <button onClick={() => setCurrentPageIndex(Math.max(1, currentPageIndex - 1))} disabled={currentPageIndex <= 1}>◀</button>
              <span>{currentPageIndex} / {pages.length - 1}</span>
              <button onClick={() => setCurrentPageIndex(Math.min(pages.length - 1, currentPageIndex + 1))} disabled={currentPageIndex >= pages.length - 1}>▶</button>
            </div>
          )}
          <button onClick={() => setIsEditing(!isEditing)} disabled={pages.length === 0} className={`btn btn-sm ${isEditing ? 'btn-warning' : 'btn-secondary'}`}>
            {isEditing ? '✓ 완료' : '✏️ 편집'}
          </button>
          <button onClick={openExportModal} disabled={pages.length <= 1 || isDownloadingPdf} className="btn btn-sm btn-success">
            {isDownloadingPdf ? `📥 ${pdfProgress.current}/${pdfProgress.total}` : '📥 PDF'}
          </button>
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

      {/* PDF 내보내기 모달 */}
      {showExportModal && (
        <div className="modal-overlay" onClick={() => setShowExportModal(false)}>
          <div className="modal export-modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>📥 PDF 내보내기</h3>
              <button className="modal-close" onClick={() => setShowExportModal(false)}>✕</button>
            </div>
            <div className="modal-body">
              <p className="export-info">총 {pages.length - 1}페이지 중 내보낼 범위를 선택하세요</p>
              <div className="export-range">
                <div className="range-input">
                  <label>시작 페이지</label>
                  <input 
                    type="number" 
                    min={1} 
                    max={pages.length - 1}
                    value={exportRange.start}
                    onChange={(e) => setExportRange(prev => ({ 
                      ...prev, 
                      start: Math.max(1, Math.min(Number(e.target.value), prev.end))
                    }))}
                  />
                </div>
                <span className="range-separator">~</span>
                <div className="range-input">
                  <label>끝 페이지</label>
                  <input 
                    type="number" 
                    min={1} 
                    max={pages.length - 1}
                    value={exportRange.end}
                    onChange={(e) => setExportRange(prev => ({ 
                      ...prev, 
                      end: Math.max(prev.start, Math.min(Number(e.target.value), pages.length - 1))
                    }))}
                  />
                </div>
              </div>
              <p className="export-summary">
                {exportRange.end - exportRange.start + 1}페이지 내보내기
              </p>
              <div className="export-actions">
                <button 
                  className="btn btn-primary"
                  onClick={() => downloadPdf(exportRange.start, exportRange.end)}
                >
                  📥 PDF 다운로드
                </button>
                <button 
                  className="btn btn-secondary"
                  onClick={() => downloadPdf(1, pages.length - 1)}
                >
                  전체 다운로드
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 저장 확인 모달 */}
      {showExitConfirm && (
        <div className="modal-overlay">
          <div className="modal exit-confirm-modal">
            <div className="modal-header">
              <h3>⚠️ 저장되지 않은 변경사항</h3>
            </div>
            <div className="modal-body">
              <p>저장하지 않은 변경사항이 있습니다. 저장하시겠습니까?</p>
              <div className="exit-confirm-buttons">
                <button 
                  className="btn btn-primary"
                  onClick={async () => {
                    await saveCurrentProject()
                    setShowExitConfirm(false)
                    setView('home')
                  }}
                >
                  💾 저장하고 나가기
                </button>
                <button 
                  className="btn btn-secondary"
                  onClick={() => {
                    setShowExitConfirm(false)
                    setHasUnsavedChanges(false)
                    setView('home')
                  }}
                >
                  저장 안 함
                </button>
                <button 
                  className="btn btn-ghost"
                  onClick={() => setShowExitConfirm(false)}
                >
                  취소
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* AI 수정 모달 */}
      {showAiEditModal && (
        <div className="modal-overlay" onClick={() => !isAiEditing && setShowAiEditModal(false)}>
          <div className="modal ai-edit-modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>✨ AI 페이지 수정</h3>
              <span className="modal-page-info">현재 {currentPageIndex + 1}페이지</span>
              <button 
                className="modal-close" 
                onClick={() => setShowAiEditModal(false)}
                disabled={isAiEditing}
              >✕</button>
            </div>
            <div className="modal-body">
              <div className="ai-edit-section">
                <label>수정 지시사항</label>
                <textarea 
                  value={aiEditInstruction}
                  onChange={e => setAiEditInstruction(e.target.value)}
                  placeholder="예: 더 자세하게 설명해줘, 예시를 추가해줘, 톤을 부드럽게 바꿔줘..."
                  disabled={isAiEditing}
                />
                <button 
                  className="btn btn-primary btn-full"
                  onClick={aiEditCurrentPage}
                  disabled={isAiEditing || !aiEditInstruction.trim()}
                >
                  {isAiEditing ? <><span className="spinner-small"></span> 수정 중...</> : '📝 지시사항대로 수정'}
                </button>
              </div>
              <div className="ai-edit-divider">또는</div>
              <div className="ai-edit-section">
                <p className="ai-edit-desc">같은 주제로 내용을 완전히 새롭게 작성합니다.</p>
                <button 
                  className="btn btn-secondary btn-full"
                  onClick={aiRegeneratePage}
                  disabled={isAiEditing}
                >
                  {isAiEditing ? <><span className="spinner-small"></span> 재생성 중...</> : '🔄 재생성'}
                </button>
              </div>
            </div>
          </div>
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
              </div>
              
              {/* AI 추가 섹션 옵션 */}
              <div className="section-block">
                <h3 className="section-label">📄 AI 추가 섹션</h3>
                <div className="extra-sections">
                  <label className="checkbox-label">
                    <input type="checkbox" checked={includePrologue} onChange={(e) => setIncludePrologue(e.target.checked)} />
                    <span>프롤로그</span>
                  </label>
                  <label className="checkbox-label">
                    <input type="checkbox" checked={includeToc} onChange={(e) => setIncludeToc(e.target.checked)} />
                    <span>목차 페이지</span>
                  </label>
                  <label className="checkbox-label">
                    <input type="checkbox" checked={includeEpilogue} onChange={(e) => setIncludeEpilogue(e.target.checked)} />
                    <span>에필로그</span>
                  </label>
                </div>
              </div>
              
              {/* 톤앤무드 설정 */}
              <div className="section-block">
                <h3 className="section-label">🎨 톤앤무드</h3>
                <select 
                  value={bookTone} 
                  onChange={(e) => setBookTone(e.target.value)}
                  className="tone-select"
                >
                  <option value="professional">💼 전문적/비즈니스</option>
                  <option value="friendly">😊 친근한/대화체</option>
                  <option value="academic">📚 학술적/교육적</option>
                  <option value="casual">🎉 캐주얼/유머러스</option>
                  <option value="inspiring">✨ 영감을 주는/동기부여</option>
                  <option value="storytelling">📖 스토리텔링/서사적</option>
                </select>
              </div>
              
              <div className="section-block toc-section">
                <div className="toc-header">
                  <h3>📑 챕터 구성</h3>
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

        {/* 복사/붙여넣기 플로팅 버튼 */}
        {selectedBlockIds.length > 0 && (
          <div className="floating-actions">
            <button 
              onClick={() => {
                if (currentPage) {
                  const blocksToCopy = currentPage.blocks.filter(b => selectedBlockIds.includes(b.id))
                  if (blocksToCopy.length > 0) {
                    setClipboardBlocks(JSON.parse(JSON.stringify(blocksToCopy)))
                  }
                }
              }}
              className="floating-btn"
              title="복사"
            >
              📋 복사
            </button>
            <button 
              onClick={() => {
                if (clipboardBlocks.length > 0 && pages.length > 0) {
                  isBlockAction.current = true
                  
                  const newBlockIds: string[] = []
                  const newBlocks = clipboardBlocks.map(b => {
                    const newId = generateId()
                    newBlockIds.push(newId)
                    return { ...b, id: newId }
                  })
                  
                  const newPages = [...pages]
                  newPages[currentPageIndex] = {
                    ...newPages[currentPageIndex],
                    blocks: [...newPages[currentPageIndex].blocks, ...newBlocks]
                  }
                  setPages(newPages)
                  saveToHistory(newPages)
                  
                  requestAnimationFrame(() => {
                    setSelectedBlockIds(newBlockIds)
                    setTimeout(() => { isBlockAction.current = false }, 50)
                  })
                }
              }}
              className="floating-btn"
              disabled={clipboardBlocks.length === 0}
              title="붙여넣기"
            >
              📄 붙여넣기
            </button>
            <button 
              onClick={() => {
                if (selectedBlockIds.length > 0 && currentPage) {
                  const newPages = [...pages]
                  newPages[currentPageIndex] = {
                    ...newPages[currentPageIndex],
                    blocks: newPages[currentPageIndex].blocks.filter(b => !selectedBlockIds.includes(b.id))
                  }
                  setPages(newPages)
                  saveToHistory(newPages)
                  setSelectedBlockIds([])
                }
              }}
              className="floating-btn danger"
              title="삭제"
            >
              🗑️ 삭제
            </button>
          </div>
        )}

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
                
                {/* zIndex 순서로 정렬하여 렌더링 */}
                {[...currentPage.blocks].sort((a, b) => (a.style?.zIndex || 0) - (b.style?.zIndex || 0)).map(block => (
                  <div
                    key={block.id}
                    className={`block ${block.type} ${selectedBlockIds.includes(block.id) ? 'selected' : ''} ${isEditing ? 'editable' : ''} ${block.locked ? 'locked' : ''} ${editingBlockId === block.id ? 'editing-active' : ''}`}
                    style={{
                      left: block.x,
                      top: block.y,
                      width: block.width,
                      zIndex: block.style?.zIndex || 0,
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
                        ref={textInputRef}
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
                      <div className="quote-content">{block.content}</div>
                    ) : block.type === 'step' ? (
                      <div className="step-box">
                        <div className="step-number" style={{ background: block.style?.numBg, color: block.style?.numColor }}>
                          {block.content.split('|')[0].replace('STEP ', '')}
                        </div>
                        <div className="step-content">{block.content.split('|')[1]}</div>
                      </div>
                    ) : block.type === 'summary' ? (
                      <div className="summary-box">
                        <div className="summary-title">{block.content.split('|')[0]}</div>
                        <div className="summary-content">{block.content.split('|')[1]}</div>
                      </div>
                    ) : block.type === 'bigquote' ? (
                      <div className="bigquote-box">
                        <span className="bigquote-mark">"</span>
                        <span>{block.content}</span>
                      </div>
                    ) : block.type === 'checklist' ? (
                      <div className="checklist-item">{block.content}</div>
                    ) : block.type === 'highlight' ? (
                      <div className="highlight-box">{block.content}</div>
                    ) : block.type === 'shape' ? (
                      <>
                        <div 
                          className="shape-box"
                          style={{
                            width: '100%',
                            height: block.height || 70,
                            background: block.style?.fill || '#3b82f6',
                            border: `${block.style?.strokeWidth || 2}px solid ${block.style?.stroke || '#1d4ed8'}`,
                            borderRadius: block.style?.shapeType === 'circle' ? '50%' : '8px',
                          }}
                        />
                        {isEditing && selectedBlockIds.includes(block.id) && !block.locked && (
                          <>
                            <div className="resize-handle resize-corner" onMouseDown={(e) => handleResizeStart(e, block, 'corner')} />
                            <div className="resize-handle resize-right" onMouseDown={(e) => handleResizeStart(e, block, 'right')} />
                            <div className="resize-handle resize-bottom" onMouseDown={(e) => handleResizeStart(e, block, 'bottom')} />
                          </>
                        )}
                      </>
                    ) : block.type === 'list' ? (
                      <div className="list-content">{block.content.startsWith('-') ? '• ' : ''}{block.content.replace(/^-\s*/, '').replace(/^\d+\.\s*/, '')}</div>
                    ) : (
                      <span dangerouslySetInnerHTML={{ __html: block.content.replace(/\n/g, '<br>').replace(/\*\*(.+?)\*\*/g, '<strong style="color:#dc2626">$1</strong>') }} />
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
                      <div className="quote-content">{block.content}</div>
                    ) : block.type === 'step' ? (
                      <div className="step-box">
                        <div className="step-number" style={{ background: block.style?.numBg, color: block.style?.numColor }}>
                          {block.content.split('|')[0].replace('STEP ', '')}
                        </div>
                        <div className="step-content">{block.content.split('|')[1]}</div>
                      </div>
                    ) : block.type === 'summary' ? (
                      <div className="summary-box">
                        <div className="summary-title">{block.content.split('|')[0]}</div>
                        <div className="summary-content">{block.content.split('|')[1]}</div>
                      </div>
                    ) : block.type === 'bigquote' ? (
                      <div className="bigquote-box">
                        <span className="bigquote-mark">"</span>
                        <span>{block.content}</span>
                      </div>
                    ) : block.type === 'checklist' ? (
                      <div className="checklist-item">{block.content}</div>
                    ) : block.type === 'highlight' ? (
                      <div className="highlight-box">{block.content}</div>
                    ) : block.type === 'shape' ? (
                      <div 
                        className="shape-box"
                        style={{
                          width: '100%',
                          height: block.height || 70,
                          background: block.style?.fill || '#3b82f6',
                          border: `${block.style?.strokeWidth || 2}px solid ${block.style?.stroke || '#1d4ed8'}`,
                          borderRadius: block.style?.shapeType === 'circle' ? '50%' : '8px',
                        }}
                      />
                    ) : block.type === 'list' ? (
                      <div className="list-content">{block.content.startsWith('-') ? '• ' : ''}{block.content.replace(/^-\s*/, '').replace(/^\d+\.\s*/, '')}</div>
                    ) : (
                      <span dangerouslySetInnerHTML={{ __html: block.content.replace(/\n/g, '<br>').replace(/\*\*(.+?)\*\*/g, '<strong style="color:#dc2626">$1</strong>') }} />
                    )}
                  </div>
                ))}
                <div className="page-number">{pageIdx + 1}</div>
              </div>
            ))}
          </div>
        </div>

        {/* 레이어 패널 (편집 모드에서만) */}
        {pages.length > 0 && isEditing && currentPage && (
          <div className="layers-panel">
            <div className="sidebar-header">
              <span>🗂️ 레이어 ({currentPage.blocks.length})</span>
            </div>
            <div className="layers-list">
              {[...currentPage.blocks]
                .sort((a, b) => (b.style?.zIndex || 0) - (a.style?.zIndex || 0))
                .map((block) => (
                  <div 
                    key={block.id}
                    className={`layer-item ${selectedBlockIds.includes(block.id) ? 'selected' : ''} ${block.locked ? 'locked' : ''}`}
                    onClick={(e) => {
                      e.stopPropagation()
                      // 이미 선택된 레이어 클릭하면 선택 해제 (토글)
                      if (selectedBlockIds.includes(block.id) && selectedBlockIds.length === 1) {
                        setSelectedBlockIds([])
                      } else {
                        setSelectedBlockIds([block.id])
                      }
                      setIsDragging(false)
                    }}
                  >
                    <span className="layer-icon">
                      {block.type === 'shape' ? (block.style?.shapeType === 'circle' ? '⭕' : '⬜') :
                       block.type === 'image' ? '🖼️' :
                       block.type === 'heading' ? '📝' :
                       block.type === 'quote' ? '💬' :
                       block.type === 'list' ? '📋' :
                       block.type === 'step' ? '🔢' :
                       block.type === 'summary' ? '🎯' :
                       block.type === 'highlight' ? '⭐' :
                       '📄'}
                    </span>
                    <span className="layer-name">
                      {block.type === 'shape' ? (block.style?.shapeType === 'circle' ? '원' : '사각형') :
                       block.type === 'image' ? '이미지' :
                       block.type === 'heading' ? block.content.slice(0, 10) + (block.content.length > 10 ? '...' : '') :
                       block.type === 'quote' ? '콜아웃' :
                       block.type === 'list' ? '목록' :
                       block.type === 'step' ? '스텝' :
                       block.type === 'summary' ? '요약' :
                       block.type === 'highlight' ? '하이라이트' :
                       block.content.slice(0, 8) + (block.content.length > 8 ? '...' : '')}
                    </span>
                    <div className="layer-actions">
                      <button 
                        className="layer-btn"
                        onClick={(e) => {
                          e.stopPropagation()
                          const maxZ = currentPage.blocks.reduce((max, b) => Math.max(max, b.style?.zIndex || 0), 0)
                          if ((block.style?.zIndex || 0) < maxZ) {
                            updatePages(prev => prev.map((p, i) => {
                              if (i !== currentPageIndex) return p
                              return {
                                ...p,
                                blocks: p.blocks.map(b => 
                                  b.id === block.id 
                                    ? { ...b, style: { ...b.style, zIndex: (b.style?.zIndex || 0) + 1 } }
                                    : b
                                )
                              }
                            }))
                          }
                        }}
                        title="위로"
                      >▲</button>
                      <button 
                        className="layer-btn"
                        onClick={(e) => {
                          e.stopPropagation()
                          const minZ = currentPage.blocks.reduce((min, b) => Math.min(min, b.style?.zIndex || 0), 0)
                          if ((block.style?.zIndex || 0) > minZ) {
                            updatePages(prev => prev.map((p, i) => {
                              if (i !== currentPageIndex) return p
                              return {
                                ...p,
                                blocks: p.blocks.map(b => 
                                  b.id === block.id 
                                    ? { ...b, style: { ...b.style, zIndex: (b.style?.zIndex || 0) - 1 } }
                                    : b
                                )
                              }
                            }))
                          }
                        }}
                        title="아래로"
                      >▼</button>
                      <button 
                        className="layer-btn"
                        onClick={(e) => {
                          e.stopPropagation()
                          updatePages(prev => prev.map((p, i) => {
                            if (i !== currentPageIndex) return p
                            return {
                              ...p,
                              blocks: p.blocks.map(b => 
                                b.id === block.id ? { ...b, locked: !b.locked } : b
                              )
                            }
                          }))
                        }}
                        title={block.locked ? '잠금 해제' : '잠금'}
                      >{block.locked ? '🔒' : '🔓'}</button>
                      <button 
                        className="layer-btn danger"
                        onClick={(e) => {
                          e.stopPropagation()
                          const newPages = [...pages]
                          newPages[currentPageIndex] = {
                            ...newPages[currentPageIndex],
                            blocks: newPages[currentPageIndex].blocks.filter(b => b.id !== block.id)
                          }
                          setPages(newPages)
                          saveToHistory(newPages)
                          if (selectedBlockIds.includes(block.id)) {
                            setSelectedBlockIds([])
                          }
                        }}
                        title="삭제"
                      >✕</button>
                    </div>
                  </div>
                ))}
            </div>
          </div>
        )}

        {/* 페이지 목록 사이드바 (기존처럼 길게) */}
        {pages.length > 1 && (
          <div className="pages-sidebar">
            <div className="sidebar-header">
              <span>📄 페이지 ({pages.length - 1})</span>
              <button onClick={addNewPage} className="btn-mini" title="맨 뒤에 페이지 추가">+</button>
            </div>
            <div className="pages-list">
              {pages.slice(1).map((page, idx) => (
                <React.Fragment key={page.id}>
                  {/* 페이지 사이에 삽입 버튼 */}
                  {idx === 0 && (
                    <button 
                      className="insert-page-btn"
                      onClick={() => insertPageAt(1)}
                      title="맨 앞에 페이지 삽입"
                    >
                      <span>+</span>
                    </button>
                  )}
                  <div 
                    className={`page-thumbnail ${(idx + 1) === currentPageIndex ? 'active' : ''}`}
                    onClick={() => setCurrentPageIndex(idx + 1)}
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
                    {pages.length > 2 && (
                      <button 
                        className="thumbnail-delete" 
                        onClick={(e) => { e.stopPropagation(); deletePage(idx + 1) }}
                        title="페이지 삭제"
                      >
                        ✕
                      </button>
                    )}
                  </div>
                  {/* 각 페이지 뒤에 삽입 버튼 */}
                  <button 
                    className="insert-page-btn"
                    onClick={() => insertPageAt(idx + 2)}
                    title={`${idx + 1}페이지 뒤에 삽입`}
                  >
                    <span>+</span>
                  </button>
                </React.Fragment>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
