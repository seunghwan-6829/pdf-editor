import { useCallback, useEffect, useRef, useState } from 'react'
import {
  checkFileSize,
  loadPdfFromFile,
  getPage,
  renderPageToCanvas,
  getTextContent,
} from './pdf/pdfLoader'
import { groupTextItemsIntoWords, type TextWord } from './pdf/textGrouping'
import { savePdfWithEdits, type EditRecord } from './pdf/pdfSaver'
import './App.css'

const SCALE = 1.5
const MAX_MB = 100

type Tool = 'edit' | 'move' | 'highlight' | 'draw'
type PageData = { viewportHeight: number; words: TextWord[] }

export default function App() {
  const [pdfDoc, setPdfDoc] = useState<Awaited<ReturnType<typeof loadPdfFromFile>> | null>(null)
  const [numPages, setNumPages] = useState(0)
  const [currentPage, setCurrentPage] = useState(1)
  const [pageDataMap, setPageDataMap] = useState<Map<number, PageData>>(new Map())
  const [edits, setEdits] = useState<EditRecord[]>([])
  const [originalArrayBuffer, setOriginalArrayBuffer] = useState<ArrayBuffer | null>(null)
  const [fileName, setFileName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [activeTool, setActiveTool] = useState<Tool>('edit')
  
  // 인라인 편집
  const [editingIndex, setEditingIndex] = useState<number | null>(null)
  const [editingText, setEditingText] = useState('')
  
  // 이동
  const [movingIndex, setMovingIndex] = useState<number | null>(null)
  const [moveOffset, setMoveOffset] = useState({ x: 0, y: 0 })

  const loadFile = useCallback(async (file: File) => {
    setError(null)
    const check = checkFileSize(file)
    if (!check.ok) {
      setError(check.message ?? '파일 크기 초과')
      return
    }
    try {
      const buffer = await file.arrayBuffer()
      setOriginalArrayBuffer(buffer)
      setFileName(file.name)
      const pdf = await loadPdfFromFile(file)
      setPdfDoc(pdf)
      setNumPages(pdf.numPages)
      setCurrentPage(1)
      setPageDataMap(new Map())
      setEdits([])
      setEditingIndex(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'PDF 로드 실패')
    }
  }, [])

  const loadPageData = useCallback(async (pageNum: number) => {
    if (!pdfDoc || pageDataMap.has(pageNum)) return
    const page = await getPage(pdfDoc, pageNum)
    const { items, viewport } = await getTextContent(page, SCALE)
    const words = groupTextItemsIntoWords(items, pageNum - 1, SCALE, viewport.height)
    setPageDataMap(m => new Map(m).set(pageNum, { viewportHeight: viewport.height, words }))
  }, [pdfDoc, pageDataMap])

  useEffect(() => {
    if (pdfDoc && currentPage) loadPageData(currentPage)
  }, [pdfDoc, currentPage, loadPageData])

  const currentData = pageDataMap.get(currentPage)
  const words = currentData?.words ?? []

  // 텍스트 수정 적용
  const applyEdit = (index: number, newText: string) => {
    const word = words[index]
    if (!word || newText === word.text) {
      setEditingIndex(null)
      return
    }
    
    const rec: EditRecord = {
      pageIndex: currentPage - 1,
      wordIndex: index,
      originalText: word.text,
      newText,
      bboxPdf: { ...word.bbox },
    }
    
    setEdits(prev => {
      const filtered = prev.filter(e => !(e.pageIndex === rec.pageIndex && e.wordIndex === rec.wordIndex))
      return [...filtered, rec]
    })
    
    // words 업데이트
    setPageDataMap(m => {
      const data = m.get(currentPage)
      if (!data) return m
      const newWords = [...data.words]
      newWords[index] = { ...newWords[index], text: newText }
      return new Map(m).set(currentPage, { ...data, words: newWords })
    })
    
    setEditingIndex(null)
  }

  // 텍스트 이동
  const moveWord = (index: number, dx: number, dy: number) => {
    setPageDataMap(m => {
      const data = m.get(currentPage)
      if (!data) return m
      const newWords = [...data.words]
      const word = newWords[index]
      newWords[index] = {
        ...word,
        bbox: {
          ...word.bbox,
          left: word.bbox.left + dx,
          top: word.bbox.top + dy,
        }
      }
      return new Map(m).set(currentPage, { ...data, words: newWords })
    })
  }

  // 저장
  const handleSave = async () => {
    if (!originalArrayBuffer) return
    setSaving(true)
    try {
      const getViewportHeight = (pageIndex: number) => pageDataMap.get(pageIndex + 1)?.viewportHeight ?? 800
      const bytes = await savePdfWithEdits(originalArrayBuffer, edits, getViewportHeight, SCALE)
      const blob = new Blob([bytes as BlobPart], { type: 'application/pdf' })
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = fileName.replace(/\.pdf$/i, '_수정본.pdf') || '수정본.pdf'
      a.click()
      URL.revokeObjectURL(a.href)
    } catch (e) {
      setError(e instanceof Error ? e.message : '저장 실패')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="app">
      <header className="header">
        <h1>PDF 편집기</h1>
        <div className="file-input-wrap">
          <input type="file" accept=".pdf" onChange={e => { 
            const f = e.target.files?.[0]
            if (f) loadFile(f)
            e.target.value = ''
          }} />
          <button className="btn btn-primary">PDF 열기 (최대 {MAX_MB}MB)</button>
        </div>
        {pdfDoc && (
          <button className="btn btn-save" onClick={handleSave} disabled={edits.length === 0 || saving}>
            {saving ? '저장 중…' : `저장 (${edits.length}건)`}
          </button>
        )}
      </header>

      {pdfDoc && (
        <div className="toolbar">
          <button className={`tool-btn ${activeTool === 'edit' ? 'active' : ''}`} onClick={() => setActiveTool('edit')}>
            ✎ 텍스트 수정
          </button>
          <button className={`tool-btn ${activeTool === 'move' ? 'active' : ''}`} onClick={() => setActiveTool('move')}>
            ✥ 텍스트 이동
          </button>
          <button className={`tool-btn ${activeTool === 'highlight' ? 'active' : ''}`} onClick={() => setActiveTool('highlight')}>
            🖍 강조
          </button>
          <button className={`tool-btn ${activeTool === 'draw' ? 'active' : ''}`} onClick={() => setActiveTool('draw')}>
            ✏ 그리기
          </button>
        </div>
      )}

      {error && <div className="error-bar">{error}</div>}

      <div className="main">
        {!pdfDoc ? (
          <div className="empty-state">
            <div className="empty-icon">📄</div>
            <p>PDF 파일을 열어 주세요</p>
          </div>
        ) : (
          <>
            <aside className="sidebar">
              <h2>페이지</h2>
              <div className="thumb-list">
                {Array.from({ length: numPages }, (_, i) => i + 1).map(n => (
                  <Thumbnail
                    key={n}
                    pdfDoc={pdfDoc}
                    pageNum={n}
                    isActive={currentPage === n}
                    onClick={() => { setCurrentPage(n); setEditingIndex(null) }}
                  />
                ))}
              </div>
            </aside>

            <div className="viewer-wrap">
              <PageViewer
                pdfDoc={pdfDoc}
                pageNum={currentPage}
                words={words}
                activeTool={activeTool}
                editingIndex={editingIndex}
                editingText={editingText}
                onStartEdit={(i) => {
                  if (activeTool === 'edit') {
                    setEditingIndex(i)
                    setEditingText(words[i].text)
                  }
                }}
                onChangeEdit={setEditingText}
                onFinishEdit={() => {
                  if (editingIndex !== null) applyEdit(editingIndex, editingText)
                }}
                onCancelEdit={() => setEditingIndex(null)}
                movingIndex={movingIndex}
                onStartMove={(i, e) => {
                  if (activeTool === 'move') {
                    setMovingIndex(i)
                    const word = words[i]
                    setMoveOffset({ x: e.clientX - word.bbox.left, y: e.clientY - word.bbox.top })
                  }
                }}
                onMove={(e) => {
                  if (movingIndex !== null && activeTool === 'move') {
                    const word = words[movingIndex]
                    const newLeft = e.clientX - moveOffset.x
                    const newTop = e.clientY - moveOffset.y
                    moveWord(movingIndex, newLeft - word.bbox.left, newTop - word.bbox.top)
                  }
                }}
                onEndMove={() => setMovingIndex(null)}
              />
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function Thumbnail({ pdfDoc, pageNum, isActive, onClick }: {
  pdfDoc: Awaited<ReturnType<typeof loadPdfFromFile>>
  pageNum: number
  isActive: boolean
  onClick: () => void
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    getPage(pdfDoc, pageNum).then(page => renderPageToCanvas(page, canvas, 0.2))
  }, [pdfDoc, pageNum])

  return (
    <div className={`thumb-item ${isActive ? 'active' : ''}`} onClick={onClick}>
      <canvas ref={canvasRef} width={100} height={130} />
      <span>{pageNum}</span>
    </div>
  )
}

function PageViewer({
  pdfDoc, pageNum, words, activeTool,
  editingIndex, editingText, onStartEdit, onChangeEdit, onFinishEdit, onCancelEdit,
  movingIndex, onStartMove, onMove, onEndMove
}: {
  pdfDoc: Awaited<ReturnType<typeof loadPdfFromFile>>
  pageNum: number
  words: TextWord[]
  activeTool: Tool
  editingIndex: number | null
  editingText: string
  onStartEdit: (i: number) => void
  onChangeEdit: (text: string) => void
  onFinishEdit: () => void
  onCancelEdit: () => void
  movingIndex: number | null
  onStartMove: (i: number, e: React.MouseEvent) => void
  onMove: (e: React.MouseEvent) => void
  onEndMove: () => void
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 })

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    getPage(pdfDoc, pageNum).then(page => {
      renderPageToCanvas(page, canvas, SCALE)
      setCanvasSize({ width: canvas.width, height: canvas.height })
    })
  }, [pdfDoc, pageNum])

  useEffect(() => {
    if (editingIndex !== null && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [editingIndex])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      onFinishEdit()
    } else if (e.key === 'Escape') {
      onCancelEdit()
    }
  }

  return (
    <div 
      ref={containerRef}
      className="page-container"
      onMouseMove={movingIndex !== null ? onMove : undefined}
      onMouseUp={onEndMove}
      onMouseLeave={onEndMove}
    >
      <canvas ref={canvasRef} className="page-canvas" />
      
      <div className="text-layer" style={{ width: canvasSize.width, height: canvasSize.height }}>
        {words.map((word, i) => (
          <div
            key={i}
            className={`text-box ${activeTool === 'edit' ? 'editable' : ''} ${activeTool === 'move' ? 'movable' : ''} ${movingIndex === i ? 'moving' : ''}`}
            style={{
              left: word.bbox.left,
              top: word.bbox.top,
              width: Math.max(word.bbox.width, 20),
              height: Math.max(word.bbox.height, 16),
            }}
            onClick={() => activeTool === 'edit' && editingIndex !== i && onStartEdit(i)}
            onMouseDown={(e) => activeTool === 'move' && onStartMove(i, e)}
          >
            {editingIndex === i ? (
              <input
                ref={inputRef}
                type="text"
                value={editingText}
                onChange={e => onChangeEdit(e.target.value)}
                onKeyDown={handleKeyDown}
                onBlur={onFinishEdit}
                className="inline-edit"
                style={{ fontSize: Math.max(word.bbox.height * 0.8, 12) }}
              />
            ) : (
              <span className="text-preview" title={word.text}>
                {word.text}
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
