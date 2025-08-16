// src/lib/utils/formatter.ts

/**
 * Format FaultMaven responses for better readability
 * @param {string} responseText - The raw response text from the server
 * @returns {string} - HTML formatted response
 */
export function formatResponse(responseText: string): string {
  // Defensive programming: ensure responseText is a string
  if (!responseText || typeof responseText !== 'string') {
    console.warn('[Formatter] Invalid response text:', typeof responseText, responseText);
    return String(responseText || '');
  }

  // Detect response type and apply appropriate formatting
  const responseType = detectResponseType(responseText)
  
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

  // Add response type wrapper for additional styling
  if (responseType !== 'general') {
    formatted = `<div class="response-type-${responseType}">${formatted}</div>`
  }

  return formatted
}

/**
 * Detect the type of response to apply appropriate formatting
 */
function detectResponseType(text: string): string {
  const lowerText = text.toLowerCase()
  
  // Troubleshooting/diagnostic responses
  if (lowerText.includes('error') || lowerText.includes('failed') || lowerText.includes('issue')) {
    return 'diagnostic'
  }
  
  // Step-by-step guides or procedures
  if (lowerText.includes('step 1') || lowerText.includes('1.') || lowerText.includes('first,')) {
    return 'procedure'
  }
  
  // Code or technical responses
  if (lowerText.includes('```') || lowerText.includes('command') || lowerText.includes('execute')) {
    return 'technical'
  }
  
  // Quick answers or definitions
  if (text.length < 200 && !lowerText.includes('\n')) {
    return 'quick-answer'
  }
  
  return 'general'
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
      .filter((cell) => cell && cell.trim())

    tableHtml += '<thead><tr>'
    headers.forEach((header) => {
      tableHtml += `<th>${header.trim()}</th>`
    })
    tableHtml += '</tr></thead>'

    // Add data rows
    tableHtml += '<tbody>'
    for (let i = 2; i < rows.length; i++) {
      const row = rows[i]
      const cells = row.split('|').filter((cell) => cell && cell.trim())
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
  // Highlight warnings and errors with icons
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

  // Highlight info/note sections
  formatted = formatted.replace(
    /(?:<br>|^)(Note:.*?)(?:<br>|$)/gi,
    '<div class="info-block">ℹ️ $1</div>'
  )
  formatted = formatted.replace(
    /(?:<br>|^)(Info:.*?)(?:<br>|$)/gi,
    '<div class="info-block">ℹ️ $1</div>'
  )

  // Highlight action items
  formatted = formatted.replace(
    /(?:<br>|^)(Action:.*?)(?:<br>|$)/gi,
    '<div class="action-item">🎯 $1</div>'
  )
  formatted = formatted.replace(
    /(?:<br>|^)(Next step:.*?)(?:<br>|$)/gi,
    '<div class="action-item">👉 $1</div>'
  )

  // Highlight step-by-step items
  formatted = formatted.replace(
    /(?:<br>|^)(Step \d+:.*?)(?:<br>|$)/gi,
    '<div class="step-item">📋 $1</div>'
  )

  // Highlight terminal commands
  formatted = formatted.replace(
    /(?:<br>|^)(\$ .+?)(?:<br>|$)/g,
    '<div class="terminal-block">$1</div>'
  )

  // Highlight severity levels
  formatted = formatted.replace(
    /(high severity|critical|urgent)/gi,
    '<span class="severity-high">$1</span>'
  )
  formatted = formatted.replace(
    /(medium severity|moderate)/gi,
    '<span class="severity-medium">$1</span>'
  )
  formatted = formatted.replace(
    /(low severity|minor)/gi,
    '<span class="severity-low">$1</span>'
  )

  // Highlight headings
  formatted = formatted.replace(/(?:<br>|^)(#{1,6} .+?)(?:<br>|$)/g, (_match, heading) => {
    const level = heading.match(/^#+/)![0].length
    const text = heading.replace(/^#+\s+/, '')
    return `<h${level} class="response-heading">${text}</h${level}>`
  })

  return formatted
}
