/** sign-up worked but Supabase wants the e-mail confirmed before the first sign-in */
export class ConfirmEmailError extends Error {
  constructor(public email: string) { super('Account created! Please confirm your e-mail, then sign in.') }
}
