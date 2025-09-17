import '../styles/globals.css'
import type { AppProps } from 'next/app'
import { SessionProvider } from 'next-auth/react'
import { useRouter } from 'next/router'
import Layout from '../components/Layout'

export default function App({ 
  Component, 
  pageProps: { session, ...pageProps } 
}: AppProps) {
  const router = useRouter()
  
  // Don't wrap login page in Layout
  const isAuthPage = router.pathname.startsWith('/auth/')
  
  if (isAuthPage) {
    return (
      <SessionProvider session={session}>
        <Component {...pageProps} />
      </SessionProvider>
    )
  }

  return (
    <SessionProvider session={session}>
      <Layout>
        <Component {...pageProps} />
      </Layout>
    </SessionProvider>
  )
}
