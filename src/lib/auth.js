import GoogleProvider from "next-auth/providers/google";

const ALLOWED_EMAIL_DOMAIN = "lilikoiagency.com";

export const authOptions = {
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_AUTH_CLIENT_ID || "",
      clientSecret: process.env.GOOGLE_AUTH_CLIENT_SECRET || "",
    }),
  ],
  pages: {
    signIn: "/",
  },
  session: {
    strategy: "jwt",
  },
  callbacks: {
    async signIn({ profile, user }) {
      const email = profile?.email || user?.email || "";
      return email.toLowerCase().endsWith(`@${ALLOWED_EMAIL_DOMAIN}`);
    },
    async jwt({ token, user, profile }) {
      if (user?.email || profile?.email) {
        token.email = user?.email || profile?.email;
      }

      return token;
    },
    async session({ session, token }) {
      if (session.user && token.email) {
        session.user.email = token.email;
      }

      return session;
    },
  },
  secret: process.env.NEXTAUTH_SECRET,
};

export const allowedEmailDomain = ALLOWED_EMAIL_DOMAIN;
