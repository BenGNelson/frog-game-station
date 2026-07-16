import { Routes, Route, Navigate } from 'react-router-dom'
import FrogBrowser from './frog/FrogBrowser.jsx'
import Player from './Player.jsx'

// The whole app is Frog. Two routes:
//   /frog  — the games browser (boot → shelf → game list → game page, with search
//            reachable from anywhere). This is the home.
//   /play  — the emulator player. A real route (not a modal) so the phone's back
//            gesture exits the game and unmounting tears the engine down completely.
//            FrogBrowser navigates here to play.
// Everything else redirects to the browser.
export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/frog" replace />} />
      <Route path="/frog" element={<FrogBrowser />} />
      <Route path="/play" element={<Player />} />
      <Route path="*" element={<Navigate to="/frog" replace />} />
    </Routes>
  )
}
