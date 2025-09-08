import * as XLSX from 'xlsx'

export interface SheetData {
  name: string
  data: string[][]
  textContent: string
}

export interface XLSXProcessResult {
  sheets: SheetData[]
  summary: string
  totalCells: number
  sheetCount: number
}

/**
 * Processa um arquivo XLSX e extrai conteúdo de todas as abas
 */
export function processXLSXFile(fileBuffer: ArrayBuffer): XLSXProcessResult {
  try {
    const workbook = XLSX.read(fileBuffer, { type: 'array' })
    const sheets: SheetData[] = []
    let totalCells = 0

    // Processar cada aba da planilha
    for (const sheetName of workbook.SheetNames) {
      const worksheet = workbook.Sheets[sheetName]
      
      // Converter para array de arrays
      const sheetData = XLSX.utils.sheet_to_json(worksheet, { 
        header: 1,
        defval: '',
        raw: false
      }) as string[][]

      // Filtrar linhas vazias
      const filteredData = sheetData.filter(row => 
        row.some(cell => cell && cell.toString().trim() !== '')
      )

      // Converter para texto legível
      const textContent = filteredData
        .map(row => row.join('\t'))
        .join('\n')

      sheets.push({
        name: sheetName,
        data: filteredData,
        textContent
      })

      totalCells += filteredData.reduce((acc, row) => acc + row.length, 0)
    }

    // Criar resumo do arquivo
    const summary = `Planilha Excel com ${workbook.SheetNames.length} aba(s): ${workbook.SheetNames.join(', ')}`

    return {
      sheets,
      summary,
      totalCells,
      sheetCount: workbook.SheetNames.length
    }
  } catch (error) {
    console.error('Erro ao processar arquivo XLSX:', error)
    throw new Error('Falha ao processar arquivo Excel')
  }
}

/**
 * Converte o resultado do processamento em texto plano para transcrição
 */
export function xlsxToText(xlsxResult: XLSXProcessResult): string {
  let text = `=== ARQUIVO EXCEL ===\n`
  text += `Resumo: ${xlsxResult.summary}\n`
  text += `Total de abas: ${xlsxResult.sheetCount}\n`
  text += `Total de células: ${xlsxResult.totalCells}\n\n`

  xlsxResult.sheets.forEach((sheet, index) => {
    text += `=== ABA ${index + 1}: ${sheet.name} ===\n`
    text += sheet.textContent
    text += '\n\n'
  })

  return text
}
