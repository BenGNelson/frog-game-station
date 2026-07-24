import { describe, it, expect } from 'vitest'
import { renderToString } from 'react-dom/server'
import TrailerOverlay, { trailerEmbedUrl } from './Trailer.jsx'

// The trailer overlay is the one deliberate external frame in the app, so the URL it
// builds is a contract: the no-cookie domain (what nginx's CSP frame-src allows by
// name) and nothing else.

describe('trailerEmbedUrl', () => {
  it('builds a youtube-nocookie embed URL', () => {
    expect(trailerEmbedUrl('dQw4w9WgXcQ')).toBe(
      'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?autoplay=1&rel=0&playsinline=1'
    )
  })

  it('URL-encodes a hostile id rather than letting it escape the path', () => {
    expect(trailerEmbedUrl('a/b?c')).toContain('/embed/a%2Fb%3Fc?')
  })
})

const videos = [
  { id: 'vid1', name: 'Trailer' },
  { id: 'vid2', name: 'Gameplay video' },
]
const noop = () => {}

describe('TrailerOverlay', () => {
  it('renders the focused video in an embedded frame with an honest label', () => {
    const html = renderToString(
      <TrailerOverlay gameName="Test Game" videos={videos} index={0} onClose={noop} onNav={noop} />
    )
    expect(html).toContain('frog-trailer')
    expect(html).toContain('https://www.youtube-nocookie.com/embed/vid1')
    expect(html).toContain('Test Game — Trailer')
    expect(html).toContain('Trailer · 1 / 2') // the set pill, since there are two
    expect(html).toContain('Next video') // only the forward arrow at the start
    expect(html).not.toContain('Previous video')
  })

  it('pages: the last video offers only the back arrow', () => {
    const html = renderToString(
      <TrailerOverlay gameName="Test Game" videos={videos} index={1} onClose={noop} onNav={noop} />
    )
    expect(html).toContain('/embed/vid2')
    expect(html).toContain('Previous video')
    expect(html).not.toContain('Next video')
  })

  it('a single video drops the counter and both arrows', () => {
    const html = renderToString(
      <TrailerOverlay gameName="Test Game" videos={[videos[0]]} index={0} onClose={noop} onNav={noop} />
    )
    expect(html).not.toContain('1 / 1')
    expect(html).not.toContain('Previous video')
    expect(html).not.toContain('Next video')
  })

  it('an out-of-range index renders nothing (a video list that shrank underneath)', () => {
    expect(
      renderToString(<TrailerOverlay gameName="G" videos={videos} index={5} onClose={noop} onNav={noop} />)
    ).toBe('')
  })
})
