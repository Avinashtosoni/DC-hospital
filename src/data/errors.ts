/** sign-up worked but Supabase wants the e-mail confirmed before the first sign-in */
export class ConfirmEmailError extends Error {
  constructor(public email: string) { super('Account created! Please confirm your e-mail, then sign in.') }
}

export type OtpChannelId = 'whatsapp' | 'sms' | 'email'
/** login_otp_status() (scripts/sql/otp_verify.sql) */
export interface OtpStatus {
  scope: 'hospital' | 'team' | null
  /** sign-in OTP applies to this account */
  required: boolean
  /** this session entered its code */
  verified: boolean
  /** may use the app (verified, not required, impersonation, or no channel reaches them) */
  passed: boolean
  /** where a code can go, masked */
  channels: { channel: OtpChannelId; to: string }[]
  impersonation?: boolean
}

/** signed in, but this session still has to enter its sign-in code */
export class OtpRequiredError extends Error {
  constructor(public status: OtpStatus) { super('Enter the verification code we sent you.') }
}
