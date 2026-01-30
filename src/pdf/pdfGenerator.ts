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
  pageSize: PageSize = 'A4'
): Promise<void> {
  const pages = container.querySelectorAll('.book-page')
  if (pages.length === 0) {
    throw new Error('PDF로 변환할 페이지가 없습니다')
  }

  const dim = PAGE_DIMENSIONS[pageSize]
  const pdf = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: [dim.width, dim.height],
  })

  for (let i = 0; i < pages.length; i++) {
    const page = pages[i] as HTMLElement

    const canvas = await html2canvas(page, {
      scale: 3,
      useCORS: true,
      logging: false,
      backgroundColor: '#ffffff',
    })

    const imgData = canvas.toDataURL('image/png')

    if (i > 0) {
      pdf.addPage()
    }

    pdf.addImage(imgData, 'PNG', 0, 0, dim.width, dim.height)
  }

  pdf.save(`${title}.pdf`)
}
