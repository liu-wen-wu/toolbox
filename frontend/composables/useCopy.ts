// Unified clipboard copy utility with browser compatibility handling
// On HTTP: uses document.execCommand('copy') (the only reliable method)
// On HTTPS: tries Clipboard API first, falls back to execCommand
// Usage in any .vue: const { copy, copied, copyError } = useCopy()

export function useCopy() {
  const copied = ref(false)
  const copyError = ref('')

  /**
   * execCommand fallback — works on HTTP in most browsers
   * Creates a hidden textarea, selects its content, and executes 'copy'.
   */
  function execCopy(text: string): boolean {
    try {
      const textarea = document.createElement('textarea')
      textarea.value = text
      textarea.style.position = 'fixed'
      textarea.style.opacity = '0'
      textarea.style.left = '-9999px'
      document.body.appendChild(textarea)
      textarea.select()
      const success = document.execCommand('copy')
      document.body.removeChild(textarea)
      return success
    } catch {
      return false
    }
  }

  async function copy(text: string): Promise<boolean> {
    if (!text) return false
    copyError.value = ''

    // Check protocol — Clipboard API only works on HTTPS / localhost
    const isSecure = location.protocol === 'https:' || location.hostname === 'localhost'

    if (isSecure) {
      // === Strategy 1: Modern Clipboard API (HTTPS / localhost only) ===
      try {
        // Defensive: navigator.clipboard may be undefined even on HTTPS in some browsers
        if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
          await navigator.clipboard.writeText(text)
          copied.value = true
          setTimeout(() => { copied.value = false }, 1500)
          return true
        }
      } catch {
        // Fall through to execCommand
      }
    }

    // === Strategy 2: Fallback via document.execCommand('copy') ===
    // Works on HTTP and HTTPS; deprecated but widely supported
    if (execCopy(text)) {
      copied.value = true
      setTimeout(() => { copied.value = false }, 1500)
      return true
    }

    // === Both strategies failed ===
    copyError.value = '当前环境不支持自动复制，请手动选择文本后按 Ctrl+C'
    return false
  }

  return { copy, copied, copyError }
}
