// Shape of our single-user session (Hard rule 9).
declare namespace CookieSessionInterfaces {
  interface CookieSessionObject {
    authed?: boolean;
    loginAt?: number;
  }
}
