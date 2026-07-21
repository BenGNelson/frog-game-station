import { useCallback, useEffect, useState } from 'react'
import { isIOS } from './playerMode.js'
import {
  currentDeferred,
  getDismissed,
  installNudgeState,
  isStandalone,
  setDismissed,
  subscribeDeferred,
} from './installPrompt.js'

// The installable-PWA nudge, as a hook. It reads the beforeinstallprompt event that
// primeInstallCapture() grabbed at app start (so a late-mounting nudge never misses
// it), fires that prompt from OUR button, notices when the app gets installed, and
// remembers a dismissal so it only ever asks once. iOS has no such event — installing
// is a manual Share → "Add to Home Screen" — so there we just detect the un-installed
// Safari case and hand back mode:'ios' for a hint.
export function useInstallPrompt() {
  const [deferred, setDeferred] = useState(() => currentDeferred())
  const [dismissed, setDismissedState] = useState(() => getDismissed())
  const [standalone, setStandalone] = useState(() => isStandalone())

  useEffect(
    () =>
      subscribeDeferred((e) => {
        setDeferred(e)
        // appinstalled reports as a null event — the app is now standalone.
        if (e === null) setStandalone(true)
      }),
    [],
  )

  const promptInstall = useCallback(async () => {
    if (!deferred) return
    deferred.prompt()
    try {
      await deferred.userChoice
    } catch {
      /* user gesture lost / already used — non-fatal */
    }
    // The event is single-use; drop it either way so the button can't re-fire a spent one.
    setDeferred(null)
  }, [deferred])

  const dismiss = useCallback(() => {
    setDismissed()
    setDismissedState(true)
  }, [])

  const { show, mode } = installNudgeState({ deferred, ios: isIOS(), standalone, dismissed })
  return { show, mode, promptInstall, dismiss }
}
