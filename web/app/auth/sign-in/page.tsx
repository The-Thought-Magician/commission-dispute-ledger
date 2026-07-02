'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { authClient } from '@/lib/auth/client'

export default function SignIn() {
  const router = useRouter()
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    const fd = new FormData(e.currentTarget)
    const { error } = await authClient.signIn.email({
      email: fd.get('email') as string,
      password: fd.get('password') as string,
    })
    setLoading(false)
    if (error) {
      setError(error.message ?? 'Failed to sign in')
      return
    }
    router.push('/dashboard')
  }

  return (
    <main className="min-h-screen bg-slate-950 flex items-center justify-center px-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <Link href="/" className="text-2xl font-bold tracking-tight">
            <span className="text-fuchsia-400">Commission</span>
            <span className="text-white">DisputeLedger</span>
          </Link>
          <h1 className="text-2xl font-bold mt-4 text-white">Sign in to your account</h1>
        </div>
        <form onSubmit={handleSubmit} className="bg-slate-900 rounded-xl border border-slate-800 p-8 space-y-4">
          {error && (
            <div className="bg-red-900/30 border border-red-700 text-red-400 rounded-lg p-3 text-sm">{error}</div>
          )}
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1">Email</label>
            <input
              name="email"
              type="email"
              required
              className="w-full bg-slate-800 border border-slate-700 rounded-lg px-4 py-3 text-white focus:outline-none focus:border-fuchsia-500"
              placeholder="you@example.com"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1">Password</label>
            <input
              name="password"
              type="password"
              required
              className="w-full bg-slate-800 border border-slate-700 rounded-lg px-4 py-3 text-white focus:outline-none focus:border-fuchsia-500"
            />
          </div>
          <button
            type="submit"
            disabled={loading}
            className="w-full bg-fuchsia-600 hover:bg-fuchsia-500 disabled:opacity-50 text-white py-3 rounded-lg font-semibold transition-colors"
          >
            {loading ? 'Signing in...' : 'Sign In'}
          </button>
          <p className="text-center text-slate-400 text-sm">
            No account?{' '}
            <Link href="/auth/sign-up" className="text-fuchsia-400 hover:text-fuchsia-300">
              Sign up
            </Link>
          </p>
        </form>
      </div>
    </main>
  )
}
