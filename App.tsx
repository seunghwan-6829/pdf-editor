import { useState } from 'react'
import { generatePdf } from './pdf/pdfGenerator'
import './App.css'

export default function App() {
  const [prompt, setPrompt] = useState('')
  const [content, setContent] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const generateContent = async () => {
    if (!prompt.trim()) {
      setError('프롬프트를 입력해주세요')
      return
    }

    setIsLoading(true)
    setError(null)

    try {
      const response = await fetch('/api/generate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ prompt })
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || `API 오류: ${response.status}`)
      }

      setContent(data.content)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'API 호출 실패')
    } finally {
      setIsLoading(false)
    }
  }

  const downloadPdf = async () => {
    if (!content.trim()) {
      setError('먼저 내용을 생성해주세요')
      return
    }

    try {
      const pdfBytes = await generatePdf(content)
      const blob = new Blob([pdfBytes], { type: 'application/pdf' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = 'document.pdf'
      a.click()
      URL.revokeObjectURL(url)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'PDF 생성 실패')
    }
  }

  return (
    <div className="app">
      <header className="header">
        <h1>📄 AI PDF 제작</h1>
        <span className="powered-by">Powered by Claude</span>
      </header>

      {error && <div className="error-bar">{error}</div>}

      <div className="main">
        <div className="input-section">
          <h2>프롬프트 입력</h2>
          <textarea
            placeholder="작성할 문서의 주제나 내용을 입력하세요...

예시:
- 2024년 AI 기술 트렌드 보고서
- 프로젝트 기획서: 모바일 앱 개발
- 마케팅 전략 분석 리포트"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            className="prompt-input"
          />
          <div className="button-row">
            <button 
              onClick={generateContent} 
              disabled={isLoading}
              className="btn btn-primary"
            >
              {isLoading ? '생성 중...' : '✨ AI로 작성하기'}
            </button>
            <button 
              onClick={downloadPdf}
              disabled={!content.trim()}
              className="btn btn-success"
            >
              📥 PDF 다운로드
            </button>
          </div>
        </div>

        <div className="output-section">
          <h2>미리보기</h2>
          <div className="preview">
            {content ? (
              <MarkdownPreview content={content} />
            ) : (
              <div className="empty-preview">
                <span>👆</span>
                <p>프롬프트를 입력하고 "AI로 작성하기" 버튼을 누르세요</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// 간단한 Markdown 렌더러
function MarkdownPreview({ content }: { content: string }) {
  const html = parseMarkdown(content)
  return <div className="markdown-body" dangerouslySetInnerHTML={{ __html: html }} />
}

function parseMarkdown(md: string): string {
  let html = md
    // 코드 블록
    .replace(/```(\w*)\n([\s\S]*?)```/g, '<pre><code>$2</code></pre>')
    // 인라인 코드
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    // 헤더
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/^# (.+)$/gm, '<h1>$1</h1>')
    // 굵게/기울임
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
    // 순서 없는 목록
    .replace(/^- (.+)$/gm, '<li>$1</li>')
    // 순서 있는 목록
    .replace(/^\d+\. (.+)$/gm, '<li>$1</li>')
    // 줄바꿈
    .replace(/\n\n/g, '</p><p>')
    .replace(/\n/g, '<br>')

  // 표 처리
  html = parseTable(html)

  return `<p>${html}</p>`
}

function parseTable(html: string): string {
  const tableRegex = /\|(.+)\|[\r\n]+\|[-:\s|]+\|[\r\n]+((?:\|.+\|[\r\n]*)+)/g
  
  return html.replace(tableRegex, (_, header, body) => {
    const headers = header.split('|').filter((h: string) => h.trim())
    const rows = body.trim().split(/[\r\n]+/).map((row: string) => 
      row.split('|').filter((c: string) => c.trim())
    )

    let table = '<table><thead><tr>'
    headers.forEach((h: string) => {
      table += `<th>${h.trim()}</th>`
    })
    table += '</tr></thead><tbody>'
    
    rows.forEach((row: string[]) => {
      table += '<tr>'
      row.forEach((cell: string) => {
        table += `<td>${cell.trim()}</td>`
      })
      table += '</tr>'
    })
    table += '</tbody></table>'
    
    return table
  })
}
