// src/lib/utils/formatter.ts

/**
 * Format FaultMaven responses for better readability
 * @param {string} responseText - The raw response text from the server
 * @returns {string} - HTML formatted response
 */
export function formatResponse(responseText: string): string {
  if (!responseText) return ''

  // Convert newlines to <br> tags
  let formatted = responseText.replace(/\n/g, '<br>')

  // Format inline markdown (bold, italic, code)
  formatted = formatInlineMarkdown(formatted)

  // Format code blocks
  formatted = formatCodeBlocks(formatted)

  // Format lists
  formatted = formatLists(formatted)

  // Format tables if present
  formatted = formatTables(formatted)

  // Highlight important sections
  formatted = highlightImportantSections(formatted)

  return formatted
}

/**
 * Format inline markdown (bold, italic, code)
 */
function formatInlineMarkdown(text: string): string {
  // Bold text: **text** or __text__
  text = text.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
  text = text.replace(/__(.*?)__/g, '<strong>$1</strong>')
  
  // Italic text: *text* or _text_
  text = text.replace(/\*(.*?)\*/g, '<em>$1</em>')
  text = text.replace(/_(.*?)_/g, '<em>$1</em>')
  
  // Inline code: `code`
  text = text.replace(/`([^`]+)`/g, '<code class="inline-code">$1</code>')
  
  return text
}

/**
 * Format code blocks (text between triple backticks)
 */
function formatCodeBlocks(text: string): string {
  // Match code blocks with or without language specification
  const codeBlockRegex = /```(?:([\w-]+)\n)?([\s\S]*?)```/g

  return text.replace(codeBlockRegex, (_match, language: string, code: string) => {
    // Clean up the code
    const cleanedCode = code.trim()
    const langClass = language ? ` class="language-${language}"` : ''

    return `<div class="code-block"><div class="code-header">${language || 'code'}</div><pre${langClass}><code>${cleanedCode}</code></pre></div>`
  })
}

/**
 * Format bullet and numbered lists
 */
function formatLists(text: string): string {
  // Process bullet lists (lines starting with - or *)
  let formatted = text.replace(/(?:<br>|^)([-*] .+?)(?:<br>|$)/g, '<ul><li>$1</li></ul>')

  // Combine adjacent list items
  formatted = formatted.replace(/<\/ul><ul>/g, '')

  // Process numbered lists (lines starting with 1., 2., etc)
  formatted = formatted.replace(/(?:<br>|^)(\d+\. .+?)(?:<br>|$)/g, '<ol><li>$1</li></ol>')

  // Combine adjacent list items
  formatted = formatted.replace(/<\/ol><ol>/g, '')

  return formatted
}

/**
 * Format tables
 */
function formatTables(text: string): string {
  // Simple table parsing for markdown-style tables
  const tableRegex = /<br>\|(.+?)\|<br>\|([-:| ]+)\|(?:<br>\|(.+?)\|)+/g

  return text.replace(tableRegex, (match) => {
    // Convert to HTML table
    const rows = match.split('<br>').filter(
      (row) => row.trim().startsWith('|') && row.trim().endsWith('|')
    )

    if (rows.length < 2) return match // Not enough rows for a table

    let tableHtml = '<div class="table-container"><table>'

    // Add header row
    const headerRow = rows[0]
    const headers = headerRow
      .split('|')
      .filter((cell) => cell.trim())

    tableHtml += '<thead><tr>'
    headers.forEach((header) => {
      tableHtml += `<th>${header.trim()}</th>`
    })
    tableHtml += '</tr></thead>'

    // Add data rows
    tableHtml += '<tbody>'
    for (let i = 2; i < rows.length; i++) {
      const row = rows[i]
      const cells = row.split('|').filter((cell) => cell.trim())
      tableHtml += '<tr>'
      cells.forEach((cell) => {
        tableHtml += `<td>${cell.trim()}</td>`
      })
      tableHtml += '</tr>'
    }
    tableHtml += '</tbody></table></div>'

    return tableHtml
  })
}

/**
 * Highlight important sections
 */
function highlightImportantSections(text: string): string {
  // Highlight warnings and errors
  let formatted = text.replace(
    /(?:<br>|^)(Warning:.*?)(?:<br>|$)/gi,
    '<div class="warning-block">⚠️ $1</div>'
  )
  formatted = formatted.replace(
    /(?:<br>|^)(Error:.*?)(?:<br>|$)/gi,
    '<div class="error-block">❌ $1</div>'
  )

  // Highlight solution sections
  formatted = formatted.replace(
    /(?:<br>|^)(Solution:.*?)(?:<br>|$)/gi,
    '<div class="solution-block">💡 $1</div>'
  )

  // Highlight headings
  formatted = formatted.replace(/(?:<br>|^)(#{1,6} .+?)(?:<br>|$)/g, (_match, heading) => {
    const level = heading.match(/^#+/)![0].length
    const text = heading.replace(/^#+\s+/, '')
    return `<h${level} class="response-heading">${text}</h${level}>`
  })

  return formatted
}
