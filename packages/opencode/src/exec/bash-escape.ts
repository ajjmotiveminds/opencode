/**
 * Bash command escaping utilities
 * 
 * Handles special characters, heredocs, quoted strings, and command substitutions.
 * Based on OpenHands implementation.
 */

export namespace BashEscape {
  /**
   * Escape characters that have different interpretations in bash vs direct execution.
   * Specifically handles escape sequences like \;, \|, \&, etc.
   * 
   * This is a simplified version - for production use, consider using a proper bash parser
   * like tree-sitter-bash or bashlex (Python).
   */
  export function escapeSpecialChars(command: string): string {
    if (!command.trim()) {
      return ""
    }

    try {
      // Simple regex-based escaping for common special characters
      // This handles most cases but may not cover all edge cases
      let result = command

      // Escape backslash-escaped special characters
      // Match \; \| \& \> \< but not when inside quotes
      result = escapeOutsideQuotes(result, /\\([;&|><])/g, "\\\\$1")

      return result
    } catch (e) {
      // If anything fails, return original command
      return command
    }
  }

  /**
   * Helper to escape pattern matches that are outside of quotes
   */
  function escapeOutsideQuotes(
    text: string,
    pattern: RegExp,
    replacement: string
  ): string {
    let result = ""
    let inSingleQuote = false
    let inDoubleQuote = false
    let inBacktick = false
    let i = 0

    while (i < text.length) {
      const char = text[i]
      const nextChar = text[i + 1]

      // Track quote state
      if (char === "'" && !inDoubleQuote && !inBacktick) {
        inSingleQuote = !inSingleQuote
        result += char
        i++
        continue
      }
      if (char === '"' && !inSingleQuote && !inBacktick) {
        inDoubleQuote = !inDoubleQuote
        result += char
        i++
        continue
      }
      if (char === "`" && !inSingleQuote && !inDoubleQuote) {
        inBacktick = !inBacktick
        result += char
        i++
        continue
      }

      // Check for $( command substitution
      if (
        char === "$" &&
        nextChar === "(" &&
        !inSingleQuote &&
        !inDoubleQuote
      ) {
        // Find matching closing paren
        let depth = 1
        let j = i + 2
        result += char + nextChar
        i += 2
        while (j < text.length && depth > 0) {
          if (text[j] === "(") depth++
          if (text[j] === ")") depth--
          result += text[j]
          j++
        }
        i = j
        continue
      }

      // Apply escaping if we're outside quotes
      if (!inSingleQuote && !inDoubleQuote && !inBacktick) {
        const remaining = text.slice(i)
        const match = remaining.match(pattern)
        if (match && match.index === 0) {
          result += match[0].replace(pattern, replacement)
          i += match[0].length
          continue
        }
      }

      result += char
      i++
    }

    return result
  }

  /**
   * Check if a command is a special key (like C-c, C-d, etc.)
   */
  export function isSpecialKey(command: string): boolean {
    const trimmed = command.trim()
    return trimmed.startsWith("C-") && trimmed.length === 3
  }
}
