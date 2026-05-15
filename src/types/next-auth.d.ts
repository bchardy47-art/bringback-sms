import 'next-auth'
import 'next-auth/jwt'

export type UserRole = 'admin' | 'manager' | 'agent' | 'dealer'

declare module 'next-auth' {
  interface User {
    tenantId: string
    role: UserRole
  }
  interface Session {
    user: {
      id: string
      email: string
      name: string
      tenantId: string
      role: UserRole
    }
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    id: string
    tenantId: string
    role: UserRole
  }
}
