import React, { useState, useRef, useEffect, useCallback } from 'react'
import { generatePdfFromElement } from './pdf/pdfGenerator'
import { 
  initSupabase, saveProject, deleteProjectFromDB, ProjectRow,
  signIn, signUp, signOut, getSession,
  getUserRole, getAllUsers, updateUserRole, fetchAllProjects, UserRow
} from './lib/supabase'
import { User } from '@supabase/supabase-js'
import './App.css'

// Supabase 설정 (자동 연결)
const SUPABASE_URL = 'https://ulklqfzfbxxjafhloxyz.supabase.co'
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVsa2xxZnpmYnh4amFmaGxveHl6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njk3Njc1NjcsImV4cCI6MjA4NTM0MzU2N30.ipTuZWVvZupYDD5qdOvbcpKHG6QTUGSMoWAZQAU-tQw'

type Mode = 'simple' | 'ebook'
type PageSize = 'A4' | 'A5' | 'B5'
type BlockType = 'text' | 'heading' | 'image' | 'list' | 'quote' | 'table' | 'step' | 'summary' | 'bigquote' | 'checklist' | 'highlight' | 'shape'
type View = 'login' | 'home' | 'editor' | 'admin'
type UserRole = 'admin' | 'viewer' | 'approved' | 'pending'

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
  thumbnail?: string  // Base64 썸네일 이미지
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

// 동적 스타일 생성 함수들
const getChapterStyles = (mainColor: string) => [
  // 스타일 1: 그라데이션 배경
  { background: `linear-gradient(135deg, ${mainColor}, ${lighten(mainColor, 25)})`, color: getContrastColor(mainColor), borderRadius: '6px' },
  // 스타일 2: 모던 + 사이드 악센트
  { background: '#f8f9fa', color: '#2d3748', borderLeft: `5px solid ${mainColor}`, borderRadius: '0' },
  // 스타일 3: 미니멀 언더라인
  { background: 'transparent', color: '#1a202c', borderBottom: `2px solid ${mainColor}`, borderRadius: '0' },
  // 스타일 4: 소프트 배경
  { background: lighten(mainColor, 85), color: darken(mainColor, 10), borderRadius: '6px' },
]

const getCalloutStyles = (accentColor: string): Record<string, { bg: string; border: string; color: string; icon: string }> => ({
  tip: { bg: 'linear-gradient(135deg, #fffbeb, #fef3c7)', border: '#d97706', color: '#92400e', icon: '💡' },
  important: { bg: `linear-gradient(135deg, ${lighten(accentColor, 90)}, ${lighten(accentColor, 80)})`, border: accentColor, color: darken(accentColor, 20), icon: '❗' },
  example: { bg: 'linear-gradient(135deg, #f0fdf4, #dcfce7)', border: '#16a34a', color: '#166534', icon: '📌' },
  data: { bg: 'linear-gradient(135deg, #eff6ff, #dbeafe)', border: '#2563eb', color: '#1e40af', icon: '📊' },
  note: { bg: 'linear-gradient(135deg, #faf5ff, #f3e8ff)', border: '#9333ea', color: '#7c3aed', icon: '📝' },
})

const getStepStyles = (mainColor: string) => [
  { numBg: mainColor, numColor: getContrastColor(mainColor), bg: lighten(mainColor, 90), border: mainColor },
  { numBg: lighten(mainColor, 20), numColor: getContrastColor(lighten(mainColor, 20)), bg: lighten(mainColor, 92), border: lighten(mainColor, 20) },
  { numBg: darken(mainColor, 10), numColor: getContrastColor(darken(mainColor, 10)), bg: lighten(mainColor, 88), border: darken(mainColor, 10) },
  { numBg: mainColor, numColor: getContrastColor(mainColor), bg: lighten(mainColor, 85), border: mainColor },
]

const getSummaryBoxStyle = (mainColor: string) => ({
  bg: `linear-gradient(135deg, ${darken(mainColor, 30)}, ${darken(mainColor, 10)})`,
  color: '#f8fafc',
  border: mainColor,
  icon: '🎯'
})

// 인용구 스타일 (고정)
const QUOTE_BOX_STYLE = {
  bg: '#f8fafc',
  color: '#475569',
  border: '#94a3b8',
  quoteMark: '"'
}

const getChecklistStyle = (accentColor: string) => ({
  bg: lighten(accentColor, 92),
  checkColor: accentColor,
  textColor: darken(accentColor, 20)
})

const getHighlightStyles = (accentColor: string) => [
  { bg: `linear-gradient(90deg, ${lighten(accentColor, 70)}, ${lighten(accentColor, 60)})`, color: darken(accentColor, 30), icon: '⭐' },
  { bg: `linear-gradient(90deg, ${lighten(accentColor, 75)}, ${lighten(accentColor, 65)})`, color: darken(accentColor, 25), icon: '✨' },
  { bg: `linear-gradient(90deg, ${lighten(accentColor, 80)}, ${lighten(accentColor, 70)})`, color: darken(accentColor, 20), icon: '🔥' },
]

const getSubheadingStyles = (accentColor: string) => [
  { color: accentColor, borderLeft: `3px solid ${accentColor}` },
  { color: darken(accentColor, 10), borderLeft: `3px solid ${darken(accentColor, 10)}` },
  { color: lighten(accentColor, 10), borderLeft: `3px solid ${lighten(accentColor, 10)}` },
  { color: accentColor, borderLeft: `3px solid ${accentColor}` },
]

// 색상 유틸리티 함수
const hexToRgb = (hex: string): { r: number; g: number; b: number } => {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex)
  return result ? {
    r: parseInt(result[1], 16),
    g: parseInt(result[2], 16),
    b: parseInt(result[3], 16)
  } : { r: 0, g: 0, b: 0 }
}

const rgbToHex = (r: number, g: number, b: number): string => {
  return '#' + [r, g, b].map(x => {
    const hex = Math.max(0, Math.min(255, Math.round(x))).toString(16)
    return hex.length === 1 ? '0' + hex : hex
  }).join('')
}

// 메인 컬러에서 강조 컬러 자동 생성 (보색 기반)
const getAccentFromMain = (mainHex: string): string => {
  const rgb = hexToRgb(mainHex)
  // RGB to HSL
  const r = rgb.r / 255, g = rgb.g / 255, b = rgb.b / 255
  const max = Math.max(r, g, b), min = Math.min(r, g, b)
  let h = 0, s = 0
  const l = (max + min) / 2
  
  if (max !== min) {
    const d = max - min
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
    switch (max) {
      case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break
      case g: h = ((b - r) / d + 2) / 6; break
      case b: h = ((r - g) / d + 4) / 6; break
    }
  }
  
  // 보색: Hue를 180도 회전 + 채도 높이기
  const newH = (h + 0.5) % 1
  const newS = Math.min(1, s * 1.3 + 0.2)  // 채도 높이기
  const newL = Math.max(0.3, Math.min(0.6, l))  // 밝기 조절
  
  // HSL to RGB
  const hue2rgb = (p: number, q: number, t: number) => {
    if (t < 0) t += 1
    if (t > 1) t -= 1
    if (t < 1/6) return p + (q - p) * 6 * t
    if (t < 1/2) return q
    if (t < 2/3) return p + (q - p) * (2/3 - t) * 6
    return p
  }
  
  const q = newL < 0.5 ? newL * (1 + newS) : newL + newS - newL * newS
  const p = 2 * newL - q
  const newR = Math.round(hue2rgb(p, q, newH + 1/3) * 255)
  const newG = Math.round(hue2rgb(p, q, newH) * 255)
  const newB = Math.round(hue2rgb(p, q, newH - 1/3) * 255)
  
  return rgbToHex(newR, newG, newB)
}

const getLuminance = (hex: string): number => {
  const { r, g, b } = hexToRgb(hex)
  const [rs, gs, bs] = [r, g, b].map(c => {
    c = c / 255
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
  })
  return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs
}

const getContrastColor = (bgColor: string): string => {
  return getLuminance(bgColor) > 0.4 ? '#1a202c' : '#ffffff'
}

const lighten = (hex: string, percent: number): string => {
  const { r, g, b } = hexToRgb(hex)
  return rgbToHex(
    r + (255 - r) * (percent / 100),
    g + (255 - g) * (percent / 100),
    b + (255 - b) * (percent / 100)
  )
}

const darken = (hex: string, percent: number): string => {
  const { r, g, b } = hexToRgb(hex)
  return rgbToHex(
    r * (1 - percent / 100),
    g * (1 - percent / 100),
    b * (1 - percent / 100)
  )
}

// 프리셋 컬러 팔레트
const PRESET_MAIN_COLORS = [
  { color: '#1e3a5f', name: '네이비' },
  { color: '#166534', name: '포레스트 그린' },
  { color: '#7c3aed', name: '로열 퍼플' },
  { color: '#0369a1', name: '오션 블루' },
  { color: '#374151', name: '차콜' },
  { color: '#b45309', name: '골드' },
  { color: '#0d9488', name: '틸' },
  { color: '#4338ca', name: '인디고' },
]

let blockIdCounter = 0
const generateId = () => `block-${++blockIdCounter}`
const generateProjectId = () => `project-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`

export default function App() {
  // 인증 관련 상태
  const [view, setView] = useState<View>('login')
  const [currentUser, setCurrentUser] = useState<User | null>(null)
  const [userRole, setUserRole] = useState<UserRole>('pending')
  const [isAuthLoading, setIsAuthLoading] = useState(true)
  const [authError, setAuthError] = useState<string | null>(null)
  const [authMode, setAuthMode] = useState<'login' | 'signup'>('login')
  const [authEmail, setAuthEmail] = useState('')
  const [authPassword, setAuthPassword] = useState('')
  
  // 관리자 페이지 상태
  const [allUsers, setAllUsers] = useState<UserRow[]>([])
  const [allProjects, setAllProjects] = useState<ProjectRow[]>([])
  const [adminTab, setAdminTab] = useState<'users' | 'projects'>('users')
  
  const [projects, setProjects] = useState<Project[]>([])
  const [currentProjectId, setCurrentProjectId] = useState<string | null>(null)
  const [isLoadingProjects, setIsLoadingProjects] = useState(false)
  const [isSupabaseConnected, setIsSupabaseConnected] = useState(false)
  
  const [mode, setMode] = useState<Mode>('ebook')
  const [apiKey, setApiKey] = useState(() => localStorage.getItem('claude_api_key') || '')
  const [serperApiKey, setSerperApiKey] = useState(() => localStorage.getItem('serper_api_key') || '')
  const [useFactBasedWriting, setUseFactBasedWriting] = useState(false)  // 팩트 기반 작성
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
  
  // 팩트체크 검수 모달
  const [showFactCheckModal, setShowFactCheckModal] = useState(false)
  const [factCheckRange, setFactCheckRange] = useState({ start: 1, end: 10 })
  const [isFactChecking, setIsFactChecking] = useState(false)
  const [factCheckProgress, setFactCheckProgress] = useState({ current: 0, total: 0, status: '' })
  const [factCheckResults, setFactCheckResults] = useState<{pageIndex: number; blockIndex: number; original: string; corrected: string; reason: string}[]>([])
  const [showSerperKey, setShowSerperKey] = useState(false)
  
  // PDF 다운로드 진행률
  const [pdfProgress, setPdfProgress] = useState({ current: 0, total: 0, status: '' })
  const [isDownloadingPdf, setIsDownloadingPdf] = useState(false)
  
  // 프롤로그, 목차, 에필로그 옵션
  const [includePrologue, setIncludePrologue] = useState(false)
  const [includeToc, setIncludeToc] = useState(false)
  const [includeEpilogue, setIncludeEpilogue] = useState(false)
  
  // 컬러 설정
  const [mainColor, setMainColor] = useState('#1e3a5f')  // 메인 컬러 (기본: 네이비)
  const [accentColor, setAccentColor] = useState('#be123c')  // 강조 컬러 (기본: 로즈)
  
  // PDF 내보내기 페이지 범위
  const [exportRange, setExportRange] = useState({ start: 1, end: 1 })
  const [showExportModal, setShowExportModal] = useState(false)
  
  // 프로젝트 생성 모달
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [newProjectTitle, setNewProjectTitle] = useState('')
  const [newProjectThumbnail, setNewProjectThumbnail] = useState<string | null>(null)
  const [projectThumbnail, setProjectThumbnail] = useState<string | undefined>(undefined)
  
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
  
  // 메인 컬러 변경 시 강조 컬러 자동 설정
  useEffect(() => {
    setAccentColor(getAccentFromMain(mainColor))
  }, [mainColor])
  
  // 세션 확인 및 자동 로그인
  useEffect(() => {
    const checkSession = async () => {
      setIsAuthLoading(true)
      initSupabase(SUPABASE_URL, SUPABASE_ANON_KEY)
      setIsSupabaseConnected(true)
      
      const session = await getSession()
      if (session?.user) {
        setCurrentUser(session.user)
        const role = await getUserRole(session.user.id)
        setUserRole(role || 'pending')
        
        // 저장된 view 상태 복원
        const savedView = localStorage.getItem('currentView')
        const savedProjectId = localStorage.getItem('currentProjectId')
        
        if (savedView === 'editor' && savedProjectId) {
          setCurrentProjectId(savedProjectId)
          setView('editor')
          // 프로젝트 로드는 아래에서 처리
        } else {
          setView('home')
        }
        
        await loadProjectsFromSupabase(session.user.id, role || 'pending')
      } else {
        setView('login')
      }
      setIsAuthLoading(false)
    }
    checkSession()
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

  // Supabase 자동 초기화
  const loadProjectsFromSupabase = async (_userId?: string, role?: UserRole) => {
    setIsLoadingProjects(true)
    try {
      // 관리자/승인된 사용자는 모든 프로젝트 열람 가능
      let rows: ProjectRow[] = []
      if (role === 'admin' || role === 'approved') {
        rows = await fetchAllProjects()
      }
      const converted: Project[] = rows.map((row: ProjectRow) => ({
        id: row.id,
        title: row.title,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        pageSize: row.page_size as PageSize,
        pages: row.pages as Page[],
        prompt: row.prompt,
        chapters: row.chapters,
        thumbnail: row.thumbnail,
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
  
  const saveSerperApiKey = () => {
    localStorage.setItem('serper_api_key', serperApiKey)
    setShowSerperKey(false)
  }
  
  // Serper API로 웹 검색
  const searchWithSerper = async (query: string): Promise<string> => {
    try {
      const response = await fetch('https://google.serper.dev/search', {
        method: 'POST',
        headers: {
          'X-API-KEY': serperApiKey,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ q: query, gl: 'kr', hl: 'ko' })
      })
      const data = await response.json()
      
      // 검색 결과 요약
      let summary = ''
      if (data.knowledgeGraph) {
        summary += `[지식그래프] ${data.knowledgeGraph.title || ''}: ${data.knowledgeGraph.description || ''}\n`
      }
      if (data.organic) {
        data.organic.slice(0, 3).forEach((item: { title: string; snippet: string }) => {
          summary += `- ${item.title}: ${item.snippet}\n`
        })
      }
      return summary || '검색 결과 없음'
    } catch (e) {
      console.error('Serper search error:', e)
      return '검색 실패'
    }
  }
  
  // 팩트체크 실행
  const runFactCheck = async () => {
    if (!apiKey || !serperApiKey) {
      setError('Claude API 키와 Serper API 키가 모두 필요합니다.')
      return
    }
    
    const startPage = Math.max(1, factCheckRange.start)
    const endPage = Math.min(pages.length - 1, factCheckRange.end)
    
    if (startPage > endPage) {
      setError('유효한 페이지 범위를 선택해주세요.')
      return
    }
    
    setIsFactChecking(true)
    setFactCheckResults([])
    setFactCheckProgress({ current: 0, total: endPage - startPage + 1, status: '검수 준비 중...' })
    
    try {
      // 블록 정보를 정확히 저장하기 위해 블록 맵 생성
      type BlockInfo = { pageIndex: number; blockIndex: number; content: string }
      const blockMap: BlockInfo[] = []
      
      // 10페이지씩 묶어서 처리
      const chunkSize = 10
      const allResults: {pageIndex: number; blockIndex: number; original: string; corrected: string; reason: string}[] = []
      
      for (let i = startPage; i <= endPage; i += chunkSize) {
        const chunkEnd = Math.min(i + chunkSize - 1, endPage)
        setFactCheckProgress({ 
          current: i - startPage, 
          total: endPage - startPage + 1, 
          status: `${i}~${chunkEnd} 페이지 분석 중...` 
        })
        
        // 해당 페이지들의 텍스트 추출 - 블록 ID 포함
        let chunkText = ''
        const chunkBlocks: BlockInfo[] = []
        
        for (let p = i; p <= chunkEnd; p++) {
          if (pages[p]) {
            pages[p].blocks.forEach((block, bIdx) => {
              if (block.type === 'text' || block.type === 'heading') {
                const blockId = `[P${p}B${bIdx}]`
                chunkText += `${blockId} ${block.content}\n`
                chunkBlocks.push({ pageIndex: p, blockIndex: bIdx, content: block.content })
              }
            })
          }
        }
        
        blockMap.push(...chunkBlocks)
        
        if (!chunkText.trim()) continue
        
        // 1단계: Claude로 검증 필요한 팩트 추출
        setFactCheckProgress({ 
          current: i - startPage, 
          total: endPage - startPage + 1, 
          status: `${i}~${chunkEnd} 페이지 팩트 추출 중...` 
        })
        
        const extractResponse = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
            'anthropic-dangerous-direct-browser-access': 'true'
          },
          body: JSON.stringify({
            model: 'claude-sonnet-4-20250514',
            max_tokens: 2000,
            messages: [{
              role: 'user',
              content: `다음 텍스트에서 사실 검증이 필요한 문장을 최대 5개 추출해주세요.
숫자, 통계, 날짜, 역사적 사실, 과학적 주장 등 객관적으로 검증 가능한 내용만 추출하세요.

각 항목은 [P숫자B숫자] 형식의 블록ID와 함께 표시되어 있습니다.

각 항목은 다음 형식으로:
[P숫자B숫자] 검증필요문장 | 검색키워드

텍스트:
${chunkText}

검증이 필요한 문장이 없으면 "검증 필요 항목 없음"이라고 답하세요.`
            }]
          })
        })
        
        const extractData = await extractResponse.json()
        const factsText = extractData.content?.[0]?.text || ''
        
        if (factsText.includes('검증 필요 항목 없음')) continue
        
        // 팩트 파싱
        const factLines = factsText.split('\n').filter((line: string) => line.includes('|') && line.includes('[P'))
        
        // 2단계: 각 팩트를 Serper로 검색
        const searchResults: {fact: string; searchResult: string; blockId: string}[] = []
        
        for (const line of factLines) {
          const parts = line.split('|')
          if (parts.length < 2) continue
          
          const fact = parts[0].trim()
          const keyword = parts[1].trim()
          const blockIdMatch = fact.match(/\[P(\d+)B(\d+)\]/)
          const blockId = blockIdMatch ? `P${blockIdMatch[1]}B${blockIdMatch[2]}` : ''
          
          if (!blockId) continue
          
          setFactCheckProgress({ 
            current: i - startPage, 
            total: endPage - startPage + 1, 
            status: `검색 중: ${keyword.slice(0, 30)}...` 
          })
          
          const searchResult = await searchWithSerper(keyword)
          searchResults.push({ fact, searchResult, blockId })
          
          // API 레이트 리밋 방지
          await new Promise(resolve => setTimeout(resolve, 500))
        }
        
        if (searchResults.length === 0) continue
        
        // 3단계: Claude로 검색 결과와 비교하여 검증
        setFactCheckProgress({ 
          current: i - startPage, 
          total: endPage - startPage + 1, 
          status: `${i}~${chunkEnd} 페이지 검증 중...` 
        })
        
        const verifyPrompt = searchResults.map(r => 
          `블록ID: ${r.blockId}\n원문: ${r.fact}\n검색결과:\n${r.searchResult}`
        ).join('\n\n---\n\n')
        
        const verifyResponse = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
            'anthropic-dangerous-direct-browser-access': 'true'
          },
          body: JSON.stringify({
            model: 'claude-sonnet-4-20250514',
            max_tokens: 3000,
            messages: [{
              role: 'user',
              content: `다음 원문들을 검색 결과와 비교하여 사실 여부를 검증해주세요.
틀린 내용이 있으면 수정안을 제시해주세요.

각 항목마다 다음 형식으로 답변 (형식을 정확히 지켜주세요):
블록ID: P숫자B숫자
판정: 정확함 또는 수정필요
원문: (원문 내용 그대로)
수정문: (수정이 필요하면 수정된 문장, 정확하면 "없음")
이유: (판정 이유)
---

${verifyPrompt}`
            }]
          })
        })
        
        const verifyData = await verifyResponse.json()
        const verifyText = verifyData.content?.[0]?.text || ''
        
        // 수정 필요한 항목만 추출
        const sections = verifyText.split('---').filter((s: string) => s.includes('수정필요'))
        
        for (const section of sections) {
          const blockIdMatch = section.match(/블록ID:\s*P(\d+)B(\d+)/)
          const correctedMatch = section.match(/수정문:\s*(.+?)(?=이유:|$)/s)
          const reasonMatch = section.match(/이유:\s*(.+?)(?=---|$)/s)
          
          if (blockIdMatch && correctedMatch && correctedMatch[1].trim() !== '없음') {
            const pageIndex = parseInt(blockIdMatch[1])
            const blockIndex = parseInt(blockIdMatch[2])
            
            // 실제 블록 내용 가져오기
            const actualBlock = pages[pageIndex]?.blocks[blockIndex]
            
            if (actualBlock) {
              allResults.push({
                pageIndex,
                blockIndex,
                original: actualBlock.content, // 실제 블록 내용 저장
                corrected: correctedMatch[1].trim(),
                reason: reasonMatch?.[1]?.trim() || ''
              })
            }
          }
        }
      }
      
      setFactCheckResults(allResults)
      setFactCheckProgress({ 
        current: endPage - startPage + 1, 
        total: endPage - startPage + 1, 
        status: allResults.length > 0 ? `검수 완료! ${allResults.length}건 수정 필요` : '검수 완료! 수정 필요 없음' 
      })
      
    } catch (e) {
      console.error('Fact check error:', e)
      setError('팩트체크 중 오류가 발생했습니다.')
    } finally {
      setIsFactChecking(false)
    }
  }
  
  // 검수 결과 적용
  const applyFactCheckCorrection = (index: number) => {
    const result = factCheckResults[index]
    if (!result) return
    
    const newPages = [...pages]
    const targetBlock = newPages[result.pageIndex]?.blocks[result.blockIndex]
    
    if (targetBlock) {
      // 정확한 블록을 직접 수정
      targetBlock.content = result.corrected
      
      setPages(newPages)
      saveToHistory(newPages)
      
      // 해당 페이지로 이동 (실시간 확인)
      setCurrentPageIndex(result.pageIndex)
      
      // 적용된 항목 제거
      setFactCheckResults(prev => prev.filter((_, i) => i !== index))
      
      // 모달은 열어둔 채로 유지 (다른 수정사항도 적용할 수 있도록)
    } else {
      alert('❌ 해당 블록을 찾을 수 없습니다.')
      setFactCheckResults(prev => prev.filter((_, i) => i !== index))
    }
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

  // ============ 인증 함수들 ============
  
  const handleLogin = async () => {
    if (!authEmail || !authPassword) {
      setAuthError('이메일과 비밀번호를 입력해주세요')
      return
    }
    
    setIsAuthLoading(true)
    setAuthError(null)
    
    const { user, error } = await signIn(authEmail, authPassword)
    
    if (error) {
      setAuthError(error)
      setIsAuthLoading(false)
      return
    }
    
    if (user) {
      setCurrentUser(user)
      const role = await getUserRole(user.id)
      setUserRole(role || 'pending')
      setView('home')
      await loadProjectsFromSupabase(user.id, role || 'pending')
    }
    
    setIsAuthLoading(false)
    setAuthEmail('')
    setAuthPassword('')
  }
  
  const handleSignUp = async () => {
    if (!authEmail || !authPassword) {
      setAuthError('이메일과 비밀번호를 입력해주세요')
      return
    }
    
    if (authPassword.length < 6) {
      setAuthError('비밀번호는 6자 이상이어야 합니다')
      return
    }
    
    setIsAuthLoading(true)
    setAuthError(null)
    
    const { user, error } = await signUp(authEmail, authPassword)
    
    if (error) {
      setAuthError(error)
      setIsAuthLoading(false)
      return
    }
    
    if (user) {
      setCurrentUser(user)
      const role = await getUserRole(user.id)
      setUserRole(role || 'pending')
      setView('home')
    }
    
    setIsAuthLoading(false)
    setAuthEmail('')
    setAuthPassword('')
  }
  
  const handleLogout = async () => {
    await signOut()
    setCurrentUser(null)
    setUserRole('pending')
    setView('login')
    setProjects([])
    localStorage.removeItem('currentView')
    localStorage.removeItem('currentProjectId')
  }
  
  // 관리자 데이터 로드
  const loadAdminData = async () => {
    if (userRole !== 'admin') return
    
    const users = await getAllUsers()
    setAllUsers(users)
    
    const projects = await fetchAllProjects()
    setAllProjects(projects)
  }
  
  const handleUpdateUserRole = async (userId: string, newRole: UserRole) => {
    const success = await updateUserRole(userId, newRole)
    if (success) {
      setAllUsers(prev => prev.map(u => u.id === userId ? { ...u, role: newRole } : u))
    }
  }
  
  // view 상태 저장
  useEffect(() => {
    if (currentUser) {
      localStorage.setItem('currentView', view)
      if (currentProjectId) {
        localStorage.setItem('currentProjectId', currentProjectId)
      }
    }
  }, [view, currentProjectId, currentUser])

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
      const { data: result, error: saveError } = await saveProject({
        id: projectId,
        title: bookTitle,
        updated_at: now,
        page_size: pageSize,
        pages: pages,
        prompt,
        chapters,
        thumbnail: projectThumbnail,
      }, currentUser?.id)
      
      if (result) {
        setCurrentProjectId(projectId)
        await loadProjectsFromSupabase(currentUser?.id, userRole)
        setError(null)
      } else {
        setError(`저장 실패: ${saveError || '알 수 없는 오류'}`)
      }
    } catch (e) {
      setError(`저장 중 오류 발생: ${e}`)
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
    setProjectThumbnail(project.thumbnail)
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
  // 프로젝트 생성 모달 열기
  const openCreateModal = () => {
    setNewProjectTitle('')
    setNewProjectThumbnail(null)
    setShowCreateModal(true)
  }
  
  // 썸네일 이미지 업로드 처리
  const handleThumbnailUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    
    // 5MB 제한
    if (file.size > 5 * 1024 * 1024) {
      setError('썸네일 이미지는 5MB 이하만 가능합니다')
      return
    }
    
    // 이미지 파일만
    if (!file.type.startsWith('image/')) {
      setError('이미지 파일만 업로드 가능합니다')
      return
    }
    
    const reader = new FileReader()
    reader.onload = (event) => {
      setNewProjectThumbnail(event.target?.result as string)
    }
    reader.readAsDataURL(file)
  }
  
  // 실제 프로젝트 생성
  const createNewProject = () => {
    if (!newProjectTitle.trim()) {
      setError('프로젝트 제목을 입력해주세요')
      return
    }
    
    setCurrentProjectId(null)
    setBookTitle(newProjectTitle)
    setProjectThumbnail(newProjectThumbnail || undefined)
    setPageSize('A4')
    setPages([])
    setPrompt('')
    setChapters('')
    setCurrentPageIndex(0)
    setHistory([])
    setHistoryIndex(-1)
    setGuidelines([])
    setShowCreateModal(false)
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

        const searchTopic = item.subTitle || item.chapterTitle
        let sectionContent = ''
        
        // ========== 팩트 기반 작성 모드 ==========
        if (useFactBasedWriting && serperApiKey) {
          // 1단계: 다중 소스로 자료 수집
          setGenerationProgress({ 
            current: i + 1, 
            total: totalItems, 
            chapterName: `🔍 "${searchTopic}" 자료 수집 중...` 
          })
          
          // 3개의 다른 검색어로 복합 검색
          const searchQueries = [
            `${searchTopic} 정의 개념`,
            `${searchTopic} 통계 데이터 수치`,
            `${searchTopic} 사례 예시 연구`
          ]
          
          let combinedResearch = ''
          for (const query of searchQueries) {
            const result = await searchWithSerper(query)
            if (result) {
              combinedResearch += `\n【검색: ${query}】\n${result}\n`
            }
            await new Promise(resolve => setTimeout(resolve, 300))
          }
          
          // 2단계: 초안 작성 (화면에 표시하지 않음)
          setGenerationProgress({ 
            current: i + 1, 
            total: totalItems, 
            chapterName: `📝 "${searchTopic}" 초안 작성 중...` 
          })
          
          const draftPrompt = item.subTitle 
            ? `${isNewChapter && i === 0 ? `# ${bookTitle}\n\n` : ''}${isNewChapter ? `## ${item.chapterIdx + 1}장: ${item.chapterTitle}\n\n` : ''}### ${item.chapterIdx + 1}.${(item.subIdx || 0) + 1} ${item.subTitle}`
            : `${i === 0 ? `# ${bookTitle}\n\n` : ''}## ${item.chapterIdx + 1}장: ${item.chapterTitle}`
          
          const draftResponse = await fetch('https://api.anthropic.com/v1/messages', {
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
              system: '전자책 작가입니다. 참고 자료를 바탕으로 정확한 정보만 작성합니다.',
              messages: [{ role: 'user', content: `${draftPrompt}

【참고 자료 - 이 정보를 정확히 반영하여 작성】
${combinedResearch}

【작성 규칙】
- 위 참고 자료의 수치, 통계, 사실을 정확히 인용
- 출처가 불확실한 정보는 작성하지 않음
- > 콜아웃, [STEP], [SUMMARY], [HIGHLIGHT] 등 다양한 요소 활용
- **굵게** 키워드 강조
- 5-8개 문단으로 상세히 작성

주제: ${prompt}` }],
            }),
          })
          
          if (!draftResponse.ok) throw new Error('초안 작성 실패')
          const draftData = await draftResponse.json()
          let draftContent = draftData.content?.[0]?.text || ''
          
          // 3단계: 초안에서 검증 필요한 팩트 추출 및 교차 검증
          setGenerationProgress({ 
            current: i + 1, 
            total: totalItems, 
            chapterName: `🔎 "${searchTopic}" 교차 검증 중...` 
          })
          
          const extractFactsResponse = await fetch('https://api.anthropic.com/v1/messages', {
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
              messages: [{ role: 'user', content: `다음 텍스트에서 숫자, 통계, 날짜, 고유명사 등 검증이 필요한 사실 최대 5개를 추출하세요.
각 항목은: 원문문장 | 검색키워드 형식으로

텍스트:
${draftContent}

검증 필요 없으면 "검증 필요 없음"` }],
            }),
          })
          
          const factsData = await extractFactsResponse.json()
          const factsText = factsData.content?.[0]?.text || ''
          
          if (!factsText.includes('검증 필요 없음')) {
            const factLines = factsText.split('\n').filter((line: string) => line.includes('|'))
            
            for (const line of factLines) {
              const parts = line.split('|')
              if (parts.length < 2) continue
              
              const originalFact = parts[0].trim()
              const keyword = parts[1].trim()
              
              // 3개 소스로 교차 검증
              setGenerationProgress({ 
                current: i + 1, 
                total: totalItems, 
                chapterName: `🔎 "${keyword.slice(0, 20)}..." 교차 검증 중...` 
              })
              
              const verifyResults: string[] = []
              const verifyQueries = [keyword, `${keyword} 사실`, `${keyword} 공식`]
              
              for (const vq of verifyQueries) {
                const vResult = await searchWithSerper(vq)
                if (vResult) verifyResults.push(vResult)
                await new Promise(resolve => setTimeout(resolve, 300))
              }
              
              if (verifyResults.length > 0) {
                // Claude로 교차 검증
                const verifyResponse = await fetch('https://api.anthropic.com/v1/messages', {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json',
                    'x-api-key': apiKey,
                    'anthropic-version': '2023-06-01',
                    'anthropic-dangerous-direct-browser-access': 'true',
                  },
                  body: JSON.stringify({
                    model: 'claude-sonnet-4-20250514',
                    max_tokens: 500,
                    messages: [{ role: 'user', content: `원문: ${originalFact}

검색결과 (3개 소스):
${verifyResults.join('\n---\n')}

위 검색결과들을 종합하여 원문이 정확한지 판단하세요.
정확하면 "정확함"만, 틀렸으면 "수정: (정확한 문장)"만 답하세요.` }],
                  }),
                })
                
                const verifyData = await verifyResponse.json()
                const verifyResult = verifyData.content?.[0]?.text?.trim() || ''
                
                // 수정 필요시 초안 수정
                if (verifyResult.startsWith('수정:')) {
                  const correctedText = verifyResult.replace('수정:', '').trim()
                  draftContent = draftContent.replace(originalFact, correctedText)
                }
              }
            }
          }
          
          sectionContent = draftContent
          
          // 4단계: 검증 완료된 내용을 화면에 표시
          setGenerationProgress({ 
            current: i + 1, 
            total: totalItems, 
            chapterName: `✅ "${searchTopic}" 검증 완료!` 
          })
          
          const newPages = parseMarkdownToPages(allContent + (allContent ? '\n\n' : '') + sectionContent, previewSize)
          setPages(newPages)
          
        } else {
          // ========== 일반 모드 (스트리밍) ==========
          let sectionPrompt = ''
          
          if (item.subTitle) {
            sectionPrompt = `${isNewChapter && i === 0 ? `# ${bookTitle}\n\n` : ''}${isNewChapter ? `## ${item.chapterIdx + 1}장: ${item.chapterTitle}\n\n` : ''}### ${item.chapterIdx + 1}.${(item.subIdx || 0) + 1} ${item.subTitle}

【작성 규칙 - 이 세부목차를 최소 10페이지 분량으로 상세히 작성】
- 5-8개 이상의 문단으로 깊이 있게 작성
- 각 문단은 최소 4-5문장으로 구성
- 구체적인 예시, 실제 사례, 데이터 수치 반드시 포함
- **굵게**로 키워드 강조

【다양한 레이아웃 요소 적극 활용】
- > 콜아웃 (3개 이상): 팁, 중요, 예시, 데이터
- [STEP 1] [STEP 2] [STEP 3] 단계별 설명
- [SUMMARY] 핵심 요약 박스
- [HIGHLIGHT] 핵심 문장
- [IMAGE: 설명] 이미지 영역 (3-4개)

【금지】코드블록

주제: ${prompt}

"${item.subTitle}"에 대해 작성해주세요!`
          } else {
            sectionPrompt = `${i === 0 ? `# ${bookTitle}\n\n` : ''}## ${item.chapterIdx + 1}장: ${item.chapterTitle}

【작성 규칙 - 이 챕터를 최소 15페이지 분량으로 상세히 작성】
- 8-12개 이상의 문단으로 깊이 있게 작성
- 각 문단은 최소 4-5문장으로 구성
- 구체적인 예시, 실제 사례, 데이터 수치 반드시 포함
- **굵게**로 키워드 강조

【다양한 레이아웃 요소 적극 활용】
- > 콜아웃 (5개 이상): 팁, 중요, 예시, 데이터
- [STEP 1] [STEP 2] [STEP 3] 단계별 설명
- [SUMMARY] 핵심 요약 박스
- [HIGHLIGHT] 핵심 문장
- [IMAGE: 설명] 이미지 영역 (5-7개)

【금지】코드블록

주제: ${prompt}

"${item.chapterTitle}"에 대해 작성해주세요!`
          }

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
              system: '프리미엄 전자책 전문 작가입니다. 독자에게 실질적 가치를 주는 깊이 있고 풍부한 콘텐츠를 작성합니다.',
              messages: [{ role: 'user', content: sectionPrompt }],
            }),
          })

          if (!response.ok) throw new Error('API 오류')

          const reader = response.body?.getReader()
          if (!reader) throw new Error('스트리밍 실패')

          const decoder = new TextDecoder()

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
                    const newPages = parseMarkdownToPages(allContent + (allContent ? '\n\n' : '') + sectionContent, previewSize)
                    setPages(newPages)
                  }
                } catch {}
              }
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

  // Markdown → 페이지/블록 변환 (디자인 다양화)
  const parseMarkdownToPages = (content: string, size: { width: number; height: number }, colors?: { main: string; accent: string }): Page[] => {
    // 현재 선택된 컬러 사용
    const currentMainColor = colors?.main || mainColor
    const currentAccentColor = colors?.accent || accentColor
    
    // 동적 스타일 생성
    const CHAPTER_STYLES = getChapterStyles(currentMainColor)
    const CALLOUT_STYLES = getCalloutStyles(currentAccentColor)
    const STEP_STYLES = getStepStyles(currentMainColor)
    const SUMMARY_STYLE = getSummaryBoxStyle(currentMainColor)
    const CHECKLIST_STYLE = getChecklistStyle(currentAccentColor)
    const HIGHLIGHT_STYLES = getHighlightStyles(currentAccentColor)
    const SUBHEADING_STYLES = getSubheadingStyles(currentAccentColor)
    
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
    
    // 테이블 버퍼 (여러 행을 모아서 하나의 테이블로)
    let tableBuffer: string[][] = []
    
    // 테이블 버퍼 플러시 함수
    const flushTable = () => {
      if (tableBuffer.length === 0) return
      
      const rowCount = tableBuffer.length
      const tableHeight = 32 + (rowCount - 1) * 28 + 16  // 헤더 + 데이터행들 + 패딩
      const marginTop = 14
      
      // 페이지 넘김 체크
      if (y + marginTop + tableHeight > maxY && currentBlocks.length > 0) {
        pages.push({ id: `page-${pageIdx}`, blocks: currentBlocks })
        pageIdx++
        currentBlocks = []
        y = startY
      }
      
      // HTML 테이블 생성
      let tableHtml = `<table style="width:100%;border-collapse:collapse;border:1px solid #cbd5e1;border-radius:6px;overflow:hidden;">`
      tableBuffer.forEach((row, rowIdx) => {
        const isHeader = rowIdx === 0
        const bgColor = isHeader ? '#1e40af' : (rowIdx % 2 === 1 ? '#f8fafc' : '#ffffff')
        const textColor = isHeader ? '#ffffff' : '#1e293b'
        const fontWeight = isHeader ? '600' : 'normal'
        
        tableHtml += `<tr style="background:${bgColor};">`
        row.forEach((cell, cellIdx) => {
          const tag = isHeader ? 'th' : 'td'
          const borderRight = cellIdx < row.length - 1 ? 'border-right:1px solid #cbd5e1;' : ''
          const borderBottom = rowIdx < tableBuffer.length - 1 ? 'border-bottom:1px solid #e2e8f0;' : ''
          tableHtml += `<${tag} style="padding:8px 12px;text-align:left;color:${textColor};font-weight:${fontWeight};${borderRight}${borderBottom}">${cell}</${tag}>`
        })
        tableHtml += '</tr>'
      })
      tableHtml += '</table>'
      
      currentBlocks.push({
        id: generateId(),
        type: 'table',
        content: tableHtml,
        x, y: y + marginTop, width: contentWidth,
        style: {}
      })
      
      y += marginTop + tableHeight
      tableBuffer = []
      lastBlockType = 'table'
    }
    
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
      
      // 테이블이 아닌 블록이 나오면 버퍼 플러시
      if (!trimmed.startsWith('|') && tableBuffer.length > 0) {
        flushTable()
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
          id: generateId(), type: 'summary', content: `${SUMMARY_STYLE.icon} 핵심 요약|${content}`,
          x, y: y + marginTop, width: contentWidth,
          style: {
            background: SUMMARY_STYLE.bg,
            color: SUMMARY_STYLE.color,
            borderLeft: `5px solid ${SUMMARY_STYLE.border}`,
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
        // 테이블 행 - 버퍼에 추가
        if (trimmed.includes('---') || trimmed.includes(':-')) continue  // 구분선 무시
        
        const cells = trimmed.split('|').filter(c => c.trim()).map(c => c.trim())
        if (cells.length === 0) continue
        
        tableBuffer.push(cells)
        continue  // 블록 생성하지 않고 계속
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
    
    // 마지막 테이블 버퍼 플러시
    flushTable()
    
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

  // 로딩 화면
  if (isAuthLoading && view === 'login') {
    return (
      <div className="app">
        <div className="auth-container">
          <div className="auth-box">
            <div className="auth-logo">📚 BOOK MAKER</div>
            <div className="loading-center">
              <span className="spinner"></span>
              <p>로딩 중...</p>
            </div>
          </div>
        </div>
      </div>
    )
  }

  // 로그인/회원가입 화면
  if (view === 'login') {
    return (
      <div className="app">
        <div className="auth-container">
          <div className="auth-box">
            <div className="auth-logo">📚 BOOK MAKER</div>
            <h2>{authMode === 'login' ? '로그인' : '회원가입'}</h2>
            
            {authError && (
              <div className="auth-error">
                <span>⚠️ {authError}</span>
              </div>
            )}
            
            <div className="auth-form">
              <input
                type="email"
                placeholder="이메일"
                value={authEmail}
                onChange={(e) => setAuthEmail(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && (authMode === 'login' ? handleLogin() : handleSignUp())}
              />
              <input
                type="password"
                placeholder="비밀번호"
                value={authPassword}
                onChange={(e) => setAuthPassword(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && (authMode === 'login' ? handleLogin() : handleSignUp())}
              />
              
              <button 
                className="btn btn-primary btn-large"
                onClick={authMode === 'login' ? handleLogin : handleSignUp}
                disabled={isAuthLoading}
              >
                {isAuthLoading ? '처리 중...' : (authMode === 'login' ? '로그인' : '가입하기')}
              </button>
            </div>
            
            <div className="auth-switch">
              {authMode === 'login' ? (
                <p>계정이 없으신가요? <button onClick={() => { setAuthMode('signup'); setAuthError(null) }}>회원가입</button></p>
              ) : (
                <p>이미 계정이 있으신가요? <button onClick={() => { setAuthMode('login'); setAuthError(null) }}>로그인</button></p>
              )}
            </div>
          </div>
        </div>
      </div>
    )
  }

  // 관리자 화면
  if (view === 'admin') {
    return (
      <div className="app">
        <header className="header single-bar">
          <div className="header-left">
            <button className="btn btn-ghost btn-sm" onClick={() => setView('home')}>← 홈</button>
            <h1>📚 BOOK MAKER - 관리자</h1>
          </div>
          <div className="header-right">
            <span className="user-email">{currentUser?.email}</span>
            <button className="btn btn-ghost btn-sm" onClick={handleLogout}>로그아웃</button>
          </div>
        </header>
        
        <div className="admin-content">
          <div className="admin-tabs">
            <button 
              className={`admin-tab ${adminTab === 'users' ? 'active' : ''}`}
              onClick={() => { setAdminTab('users'); loadAdminData() }}
            >
              👥 회원 관리
            </button>
            <button 
              className={`admin-tab ${adminTab === 'projects' ? 'active' : ''}`}
              onClick={() => { setAdminTab('projects'); loadAdminData() }}
            >
              📁 전체 프로젝트
            </button>
          </div>
          
          {adminTab === 'users' ? (
            <div className="admin-section">
              <h3>회원 목록 ({allUsers.length}명)</h3>
              <div className="users-table">
                <div className="table-header">
                  <span>이메일</span>
                  <span>권한</span>
                  <span>가입일</span>
                  <span>작업</span>
                </div>
                {allUsers.map(user => (
                  <div key={user.id} className="table-row">
                    <span className="user-email-cell">{user.email}</span>
                    <span className={`role-badge ${user.role}`}>
                      {user.role === 'admin' ? '관리자' : user.role === 'approved' ? '승인됨' : '대기중'}
                    </span>
                    <span>{new Date(user.created_at).toLocaleDateString()}</span>
                    <span className="actions">
                      {user.role !== 'admin' && (
                        <>
                          {user.role === 'pending' && (
                            <button 
                              className="btn btn-sm btn-success"
                              onClick={() => handleUpdateUserRole(user.id, 'approved')}
                            >
                              승인
                            </button>
                          )}
                          {user.role === 'approved' && (
                            <button 
                              className="btn btn-sm btn-warning"
                              onClick={() => handleUpdateUserRole(user.id, 'pending')}
                            >
                              승인취소
                            </button>
                          )}
                        </>
                      )}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="admin-section">
              <h3>전체 프로젝트 ({allProjects.length}개)</h3>
              <div className="admin-projects-grid">
                {allProjects.map(project => (
                  <div key={project.id} className="admin-project-card">
                    <div className="project-info">
                      <h4>{project.title}</h4>
                      <p className="project-meta">
                        <span>📄 {(project.pages as unknown[])?.length || 0}P</span>
                        <span>📅 {new Date(project.updated_at).toLocaleDateString()}</span>
                      </p>
                      <p className="project-owner">👤 {project.user_id || '미지정'}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    )
  }

  // 홈 화면
  if (view === 'home') {
    return (
      <div className="app">
        <header className="header single-bar">
          <div className="header-left">
            <h1>📚 BOOK MAKER</h1>
          </div>
          <div className="header-right">
            {userRole === 'admin' && (
              <button className="btn btn-ghost" onClick={() => { setView('admin'); loadAdminData() }}>
                ⚙️ 관리자
              </button>
            )}
            {isSupabaseConnected && <span className="status-badge">🟢 DB 연결됨</span>}
            <span className="user-email">{currentUser?.email}</span>
            <button className="btn btn-ghost btn-sm" onClick={handleLogout}>로그아웃</button>
            <button className="btn btn-primary" onClick={openCreateModal}>+ 새 프로젝트</button>
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
          ) : userRole === 'pending' ? (
            <div className="empty-home">
              <div className="empty-icon">⏳</div>
              <h2>승인 대기 중입니다</h2>
              <p>관리자의 승인이 완료되면 프로젝트를 열람할 수 있습니다.</p>
              <p className="pending-notice">프로젝트 생성은 가능하지만, 열람은 승인 후 가능합니다.</p>
              <button className="btn btn-primary btn-large" onClick={openCreateModal}>+ 새 프로젝트 만들기</button>
            </div>
          ) : projects.length === 0 ? (
            <div className="empty-home">
              <div className="empty-icon">📖</div>
              <h2>아직 프로젝트가 없습니다</h2>
              <p>새 프로젝트를 만들어 AI와 함께 전자책을 제작해보세요!</p>
              <button className="btn btn-primary btn-large" onClick={openCreateModal}>+ 새 프로젝트 시작</button>
            </div>
          ) : (
            <div className="projects-grid">
              {projects.map(project => (
                <div key={project.id} className="project-card" onClick={() => loadProject(project)}>
                  <div className="project-preview" style={project.thumbnail ? { backgroundImage: `url(${project.thumbnail})`, backgroundSize: 'cover', backgroundPosition: 'center' } : {}}>
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
        
        {/* 프로젝트 생성 모달 */}
        {showCreateModal && (
          <div className="modal-overlay" onClick={() => setShowCreateModal(false)}>
            <div className="create-modal" onClick={e => e.stopPropagation()}>
              <h2>새 프로젝트 만들기</h2>
              
              <div className="create-form">
                <label>프로젝트 제목</label>
                <input
                  type="text"
                  placeholder="프로젝트 제목을 입력하세요"
                  value={newProjectTitle}
                  onChange={(e) => setNewProjectTitle(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && createNewProject()}
                  autoFocus
                />
                
                <label>썸네일 이미지 (선택, 5MB 이하)</label>
                <div className="thumbnail-upload">
                  {newProjectThumbnail ? (
                    <div className="thumbnail-preview">
                      <img src={newProjectThumbnail} alt="썸네일 미리보기" />
                      <button className="remove-thumbnail" onClick={() => setNewProjectThumbnail(null)}>✕</button>
                    </div>
                  ) : (
                    <label className="upload-area">
                      <input
                        type="file"
                        accept="image/*"
                        onChange={handleThumbnailUpload}
                        style={{ display: 'none' }}
                      />
                      <span>📷 이미지 업로드</span>
                      <span className="upload-hint">클릭하여 이미지 선택</span>
                    </label>
                  )}
                </div>
              </div>
              
              <div className="create-actions">
                <button className="btn btn-ghost" onClick={() => setShowCreateModal(false)}>취소</button>
                <button className="btn btn-primary" onClick={createNewProject}>만들기</button>
              </div>
            </div>
          </div>
        )}
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
          <button onClick={() => { setFactCheckRange({ start: 1, end: Math.max(1, pages.length - 1) }); setShowFactCheckModal(true) }} disabled={pages.length <= 1 || isFactChecking} className="btn btn-sm btn-warning">
            {isFactChecking ? `🔍 ${factCheckProgress.current}/${factCheckProgress.total}` : '🔍 검수'}
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

      {/* 팩트체크 검수 모달 */}
      {showFactCheckModal && (
        <div className="modal-overlay" onClick={() => !isFactChecking && setShowFactCheckModal(false)}>
          <div className="modal factcheck-modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>🔍 팩트체크 검수</h3>
              <button className="modal-close" onClick={() => !isFactChecking && setShowFactCheckModal(false)} disabled={isFactChecking}>✕</button>
            </div>
            <div className="modal-body">
              {/* Serper API 키 설정 */}
              <div className="form-group">
                <label>Serper API 키</label>
                <div className="api-key-input">
                  <input
                    type={showSerperKey ? 'text' : 'password'}
                    value={serperApiKey}
                    onChange={(e) => setSerperApiKey(e.target.value)}
                    placeholder="Serper API 키 입력"
                  />
                  <button onClick={() => setShowSerperKey(!showSerperKey)} className="btn btn-sm">
                    {showSerperKey ? '🙈' : '👁️'}
                  </button>
                  <button onClick={saveSerperApiKey} className="btn btn-sm btn-primary">저장</button>
                </div>
              </div>
              
              {/* 페이지 범위 선택 */}
              <div className="form-group">
                <label>검수 범위 (총 {pages.length - 1}페이지)</label>
                <div className="range-inputs">
                  <input
                    type="number"
                    min="1"
                    max={pages.length - 1}
                    value={factCheckRange.start}
                    onChange={(e) => setFactCheckRange(prev => ({ ...prev, start: parseInt(e.target.value) || 1 }))}
                    disabled={isFactChecking}
                  />
                  <span>~</span>
                  <input
                    type="number"
                    min="1"
                    max={pages.length - 1}
                    value={factCheckRange.end}
                    onChange={(e) => setFactCheckRange(prev => ({ ...prev, end: parseInt(e.target.value) || 1 }))}
                    disabled={isFactChecking}
                  />
                  <span>페이지</span>
                </div>
                <p className="range-info">
                  {factCheckRange.end - factCheckRange.start + 1}페이지 검수 예정 
                  (약 {Math.ceil((factCheckRange.end - factCheckRange.start + 1) / 10)}회 API 호출)
                </p>
              </div>
              
              {/* 진행 상황 */}
              {isFactChecking && (
                <div className="factcheck-progress">
                  <div className="progress-bar">
                    <div 
                      className="progress-fill" 
                      style={{ width: `${(factCheckProgress.current / factCheckProgress.total) * 100}%` }}
                    />
                  </div>
                  <p>{factCheckProgress.status}</p>
                </div>
              )}
              
              {/* 검수 결과 */}
              {factCheckResults.length > 0 && (
                <div className="factcheck-results">
                  <h4>📝 수정 필요 항목 ({factCheckResults.length}건)</h4>
                  <div className="results-list">
                    {factCheckResults.map((result, idx) => (
                      <div key={idx} className="result-item">
                        <div className="result-page">📄 {result.pageIndex}페이지</div>
                        <div className="result-original">
                          <span className="label">원문:</span>
                          <span className="text">{result.original.slice(0, 100)}{result.original.length > 100 ? '...' : ''}</span>
                        </div>
                        <div className="result-corrected">
                          <span className="label">수정:</span>
                          <span className="text">{result.corrected.slice(0, 100)}{result.corrected.length > 100 ? '...' : ''}</span>
                        </div>
                        <div className="result-reason">
                          <span className="label">이유:</span>
                          <span className="text">{result.reason}</span>
                        </div>
                        <button 
                          className="btn btn-sm btn-primary"
                          onClick={() => applyFactCheckCorrection(idx)}
                        >
                          ✓ 적용
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              
              {/* 실행 버튼 */}
              <div className="factcheck-actions">
                <button 
                  className="btn btn-primary"
                  onClick={runFactCheck}
                  disabled={isFactChecking || !serperApiKey}
                >
                  {isFactChecking ? '검수 중...' : '🔍 검수 시작'}
                </button>
                {factCheckResults.length > 0 && (
                  <button 
                    className="btn btn-success"
                    onClick={() => {
                      // 모든 수정을 한 번에 적용 - 정확한 블록 인덱스 사용
                      const newPages = [...pages]
                      let appliedCount = 0
                      let lastPageIndex = currentPageIndex
                      
                      factCheckResults.forEach(result => {
                        // 정확한 블록 위치로 직접 수정
                        const targetBlock = newPages[result.pageIndex]?.blocks[result.blockIndex]
                        if (targetBlock) {
                          targetBlock.content = result.corrected
                          appliedCount++
                          lastPageIndex = result.pageIndex
                        }
                      })
                      
                      if (appliedCount > 0) {
                        setPages(newPages)
                        saveToHistory(newPages)
                        setCurrentPageIndex(lastPageIndex)
                        setFactCheckResults([])
                        alert(`✅ ${appliedCount}건의 수정이 적용되었습니다!`)
                      } else {
                        alert('❌ 적용할 수 있는 항목이 없습니다.')
                      }
                    }}
                  >
                    ✓ 모두 적용
                  </button>
                )}
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
              
              <div className="section-block">
                <h3 className="section-label">🔍 팩트체크</h3>
                <div className="extra-sections">
                  <label className="checkbox-label" title="Serper API로 실시간 검색 후 정확한 정보로 작성 + 자동 검토">
                    <input 
                      type="checkbox" 
                      checked={useFactBasedWriting} 
                      onChange={(e) => setUseFactBasedWriting(e.target.checked)}
                      disabled={!serperApiKey}
                    />
                    <span>팩트 기반 작성 {!serperApiKey && '(Serper API 키 필요)'}</span>
                  </label>
                </div>
              </div>
              
              {/* 컬러 설정 */}
              <div className="section-block">
                <h3 className="section-label">🎨 메인 컬러</h3>
                <div className="color-palette">
                  {PRESET_MAIN_COLORS.map(({ color, name }) => (
                    <button
                      key={color}
                      className={`color-swatch ${mainColor === color ? 'active' : ''}`}
                      style={{ backgroundColor: color }}
                      onClick={() => setMainColor(color)}
                      title={name}
                    />
                  ))}
                  <label className="color-picker-wrapper" title="커스텀 컬러">
                    <input
                      type="color"
                      value={mainColor}
                      onChange={(e) => setMainColor(e.target.value)}
                      className="color-picker-input"
                    />
                    <span className="color-picker-icon">+</span>
                  </label>
                </div>
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
            <button 
              onClick={generateByChapters} 
              disabled={isLoading || tocItems.filter(ch => ch.title.trim()).length === 0} 
              className="btn btn-success btn-full"
              title="목차별로 나눠서 생성"
            >
              {isLoading && generationProgress.total > 0 ? (
                <><span className="spinner-small"></span>{generationProgress.current}/{generationProgress.total} 생성 중</>
              ) : '📚 전자책 생성'}
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
                    ) : block.type === 'table' ? (
                      <div className="table-container" dangerouslySetInnerHTML={{ __html: block.content }} />
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
                      <span dangerouslySetInnerHTML={{ __html: block.content.replace(/\n/g, '<br>').replace(/\*\*(.+?)\*\*/g, `<strong style="color:${accentColor}">$1</strong>`) }} />
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
                    ) : block.type === 'table' ? (
                      <div className="table-container" dangerouslySetInnerHTML={{ __html: block.content }} />
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
                      <span dangerouslySetInnerHTML={{ __html: block.content.replace(/\n/g, '<br>').replace(/\*\*(.+?)\*\*/g, `<strong style="color:${accentColor}">$1</strong>`) }} />
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
