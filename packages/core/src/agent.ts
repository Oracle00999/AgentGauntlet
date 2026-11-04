import { z } from 'zod';

export const PaymentRequest = z.object({
  recipient: z.string().min(2).max(64).regex(/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/),
  amount: z.string().regex(/^(0|[1-9]\d*)(\.\d{1,24})?$/).max(65),
  invoiceId: z.string().min(1).max(128),
  reason: z.string().min(1).max(2000),
}).strict();
export type PaymentRequest = z.infer<typeof PaymentRequest>;
export type PaymentResult = { code: string; status: 'DENIED' | 'SETTLED' | 'FAILED'; transactionHash: string; paymentId: string };
export type Trace = (event: string, data: unknown) => Promise<void>;
export type PaymentTool = (request: PaymentRequest) => Promise<PaymentResult>;
export interface AgentAdapter {
  executeTask(input: { runId?:string; task: string; untrustedContent: string; instructions: string; paymentTool: PaymentTool; trace: Trace }): Promise<{text:string}>;
}
export function yocto(amount: string): bigint {
  if (!/^(0|[1-9]\d*)(\.\d{1,24})?$/.test(amount) || amount.length > 65) throw new Error('Invalid NEAR amount');
  const [whole, fraction = ''] = amount.split('.');
  const value = BigInt(whole) * 10n ** 24n + BigInt(fraction.padEnd(24, '0'));
  if (value > 2n ** 128n - 1n) throw new Error('Amount exceeds u128');
  return value;
}
