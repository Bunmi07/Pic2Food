import './App.css'
import { PhotoCapture } from './components/PhotoCapture'

function App() {
  return (
    <main className="app">
      <header className="top">
        <p className="eyebrow">Pic2Food</p>
        <h1>What’s in the fridge. What you can actually cook.</h1>
      </header>

      <section className="card" aria-labelledby="photo-guidance-heading">
        <h2 id="photo-guidance-heading">Before you take a photo</h2>
        <p>
          Results depend on how clearly the ingredients show. This app proposes
          guesses from a photo; you confirm what you actually have before any
          recipes are retrieved.
        </p>
        <ul>
          <li>Use good lighting.</li>
          <li>Spread ingredients out where you can.</li>
          <li>
            Avoid shooting through closed packaging or items hidden behind other
            objects.
          </li>
        </ul>
      </section>

      <PhotoCapture />
    </main>
  )
}

export default App
