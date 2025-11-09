import '../styles/globals.css'
import type { AppProps } from 'next/app'
import { SessionProvider } from 'next-auth/react'
import { useRouter } from 'next/router'
import Layout from '../components/Layout'
import { SnackbarProvider } from '../components/SnackbarProvider'
import { useDisableArrowAndScroll } from '../hooks/useDisableArrowAndScroll'

export default function App({
  Component,
  pageProps: { session, ...pageProps }
}: AppProps) {
  const router = useRouter()

  // Disable arrow key scrolling and number input increment/decrement globally
  useDisableArrowAndScroll()

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
      <SnackbarProvider>
        <Layout>
          <Component {...pageProps} />
        </Layout>
      </SnackbarProvider>
    </SessionProvider>
  )
}
