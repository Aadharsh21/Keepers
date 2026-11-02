import { Link } from '../../router'

export default function Landing() {
  return (
    <main style={{ padding: 32 }}>
      <h1>Keeper</h1>
      <Link href="/cull">Open the app</Link>
    </main>
  )
}
