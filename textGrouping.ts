/**
 * PDF 텍스트 아이템을 "단어/문장" 단위로 그룹핑.
 * 한글 "안녕하세요"가 글자 단위가 아니라 한 덩어리로 편집되도록.
 */
import type { TextItem } from './pdfLoader'

export type BoundingBox = {
  left: number
  top: number
  width: number
  height: number
}

export type TextWord = {
  text: string
  bbox: BoundingBox
  pageIndex: number
  itemIndices: number[] // 원본 items 인덱스 (저장 시 참조용)
}

/**
 * PDF.js TextItem의 transform에서 bbox 계산
 * transform: [scaleX, skewX, skewY, scaleY, translateX, translateY]
 * 
 * PDF 좌표계: 원점이 왼쪽 아래, y는 위로 증가
 * 뷰포트 좌표계: 원점이 왼쪽 위, y는 아래로 증가
 */
function getItemBbox(
  item: TextItem,
  scale: number,
  viewportHeight: number
): BoundingBox {
  const [, , , scaleY, x, y] = item.transform
  
  // PDF 좌표를 스케일 적용된 뷰포트 좌표로 변환
  const left = x * scale
  const width = (item.width ?? 0) * scale
  
  // 폰트 높이 계산 (transform의 scaleY 또는 item.height 사용)
  const fontHeight = Math.abs(scaleY) || item.height || 12
  const height = fontHeight * scale
  
  // PDF y좌표를 뷰포트 y좌표로 변환 (상하 반전)
  const pdfY = y * scale
  const top = viewportHeight - pdfY - height
  
  return { left, top, width, height }
}

/**
 * 같은 줄인지 판단 (y 기준 허용 오차 - 글자 높이 기준)
 */
function sameLine(a: BoundingBox, b: BoundingBox): boolean {
  const aCenterY = a.top + a.height / 2
  const bCenterY = b.top + b.height / 2
  const tolerance = Math.max(a.height, b.height) * 0.7
  return Math.abs(aCenterY - bCenterY) <= tolerance
}

/**
 * 같은 단어/문장인지 판단 (간격이 글자 높이보다 작으면 같은 그룹)
 * 한글 PDF는 글자마다 분리되어 있어서 넓은 기준 적용
 */
function isAdjacent(a: BoundingBox, b: BoundingBox): boolean {
  const aRight = a.left + a.width
  const gap = b.left - aRight
  // 간격이 글자 높이의 150% 이내면 같은 단어/문장으로 봄
  const maxGap = Math.max(a.height, b.height) * 1.5
  return gap >= -5 && gap <= maxGap
}

/**
 * 텍스트 아이템들을 단어/문장 단위로 그룹핑.
 * - 같은 줄 + 인접한 글자들을 하나의 "word"로 묶음.
 */
export function groupTextItemsIntoWords(
  items: TextItem[],
  pageIndex: number,
  scale: number,
  viewportHeight: number
): TextWord[] {
  if (items.length === 0) return []

  // 모든 아이템의 bbox 계산 (뷰포트 좌표로 변환)
  const bboxes = items.map((item) => getItemBbox(item, scale, viewportHeight))

  const words: TextWord[] = []
  let currentText = items[0].str
  let currentIndices = [0]
  let currentBbox = { ...bboxes[0] }

  for (let i = 1; i < items.length; i++) {
    const prevBbox = bboxes[i - 1]
    const currBbox = bboxes[i]
    const currItem = items[i]

    const same = sameLine(prevBbox, currBbox)
    const adjacent = isAdjacent(currentBbox, currBbox)

    if (same && adjacent) {
      // 같은 단어로 합치기
      currentText += currItem.str
      currentIndices.push(i)
      // bbox 확장
      const newRight = Math.max(currentBbox.left + currentBbox.width, currBbox.left + currBbox.width)
      const newTop = Math.min(currentBbox.top, currBbox.top)
      const newBottom = Math.max(currentBbox.top + currentBbox.height, currBbox.top + currBbox.height)
      currentBbox.width = newRight - currentBbox.left
      currentBbox.top = newTop
      currentBbox.height = newBottom - newTop
    } else {
      // 현재 단어 저장하고 새로 시작
      if (currentText.trim()) {
        words.push({
          text: currentText,
          bbox: { ...currentBbox },
          pageIndex,
          itemIndices: [...currentIndices],
        })
      }
      currentText = currItem.str
      currentIndices = [i]
      currentBbox = { ...currBbox }
    }
  }

  // 마지막 단어 저장
  if (currentText.trim()) {
    words.push({
      text: currentText,
      bbox: currentBbox,
      pageIndex,
      itemIndices: currentIndices,
    })
  }

  return words
}
