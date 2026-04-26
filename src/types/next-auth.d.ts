import 'next-auth'
import 'next-auth/jwt'

declare module 'next-auth' {
  interface User {
    tenantId: string
    role: string
  }
  interface Session {
    user: {
      id: string
      email: string
      name: string
      tenantId: string
      role: string
    }
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    id: string
    tenantId: string
    role: string
  }
}
