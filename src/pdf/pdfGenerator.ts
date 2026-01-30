import html2canvas from 'html2canvas'
import jsPDF from 'jspdf'

type PageSize = 'A4' | 'A5' | 'B5'

const PAGE_DIMENSIONS: Record<PageSize, { width: number; height: number }> = {
  A4: { width: 210, height: 297 },
  A5: { width: 148, height: 210 },
  B5: { width: 182, height: 257 },
}

export async function generatePdfFromElement(
  container: HTMLElement,
  title: string,
  pageSize: PageSize = 'A4',
  onProgress?: (current: number, total: number) => void
): Promise<void> {
  const pages = container.querySelectorAll('.book-page')
  const totalPages = pages.length
  
  if (totalPages === 0) {
    throw new Error('PDF로 변환할 페이지가 없습니다')
  }

  const dim = PAGE_DIMENSIONS[pageSize]
  const pdf = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: [dim.width, dim.height],
    compress: true,  // 압축 활성화
  })

  // 배치 크기 (메모리 관리)
  const BATCH_SIZE = 10

  for (let i = 0; i < totalPages; i++) {
    const page = pages[i] as HTMLElement

    try {
      // 캔버스 생성 (scale 낮춤, JPEG 사용으로 크기 감소)
      const canvas = await html2canvas(page, {
        scale: 2,  // 3에서 2로 낮춤
        useCORS: true,
        logging: false,
        backgroundColor: '#ffffff',
        imageTimeout: 0,
        removeContainer: true,  // 임시 컨테이너 제거
      })

      // JPEG로 변환 (PNG보다 훨씬 작음)
      const imgData = canvas.toDataURL('image/jpeg', 0.92)

      if (i > 0) {
        pdf.addPage()
      }

      pdf.addImage(imgData, 'JPEG', 0, 0, dim.width, dim.height, undefined, 'FAST')

      // 진행률 콜백
      if (onProgress) {
        onProgress(i + 1, totalPages)
      }

      // 배치마다 잠시 대기 (가비지 컬렉션 기회 부여)
      if ((i + 1) % BATCH_SIZE === 0) {
        await new Promise(resolve => setTimeout(resolve, 100))
      }

    } catch (err) {
      console.error(`Page ${i + 1} 변환 실패:`, err)
      // 실패해도 계속 진행
    }
  }

  // PDF 저장
  pdf.save(`${title}.pdf`)
}

// 대용량 PDF용 분할 생성 (300페이지 이상)
export async function generateLargePdf(
  container: HTMLElement,
  title: string,
  pageSize: PageSize = 'A4',
  onProgress?: (current: number, total: number, status: string) => void
): Promise<void> {
  const pages = container.querySelectorAll('.book-page')
  const totalPages = pages.length
  
  if (totalPages === 0) {
    throw new Error('PDF로 변환할 페이지가 없습니다')
  }

  const dim = PAGE_DIMENSIONS[pageSize]
  
  // 100페이지 이하면 일반 생성
  if (totalPages <= 100) {
    return generatePdfFromElement(container, title, pageSize, onProgress)
  }

  // 대용량: 청크로 나눠서 처리
  const CHUNK_SIZE = 50
  const chunks = Math.ceil(totalPages / CHUNK_SIZE)
  
  const pdf = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: [dim.width, dim.height],
    compress: true,
  })

  let isFirstPage = true

  for (let chunk = 0; chunk < chunks; chunk++) {
    const startIdx = chunk * CHUNK_SIZE
    const endIdx = Math.min(startIdx + CHUNK_SIZE, totalPages)
    
    if (onProgress) {
      onProgress(startIdx, totalPages, `청크 ${chunk + 1}/${chunks} 처리 중...`)
    }

    for (let i = startIdx; i < endIdx; i++) {
      const page = pages[i] as HTMLElement

      try {
        const canvas = await html2canvas(page, {
          scale: 2,
          useCORS: true,
          logging: false,
          backgroundColor: '#ffffff',
          imageTimeout: 0,
          removeContainer: true,
        })

        const imgData = canvas.toDataURL('image/jpeg', 0.85)  // 품질 약간 낮춤

        if (!isFirstPage) {
          pdf.addPage()
        }
        isFirstPage = false

        pdf.addImage(imgData, 'JPEG', 0, 0, dim.width, dim.height, undefined, 'FAST')

        if (onProgress) {
          onProgress(i + 1, totalPages, `${i + 1}/${totalPages} 페이지 처리 중...`)
        }

      } catch (err) {
        console.error(`Page ${i + 1} 변환 실패:`, err)
      }
    }

    // 청크 사이에 더 긴 대기 (메모리 해제)
    await new Promise(resolve => setTimeout(resolve, 300))
  }

  if (onProgress) {
    onProgress(totalPages, totalPages, 'PDF 저장 중...')
  }

  pdf.save(`${title}.pdf`)
}
