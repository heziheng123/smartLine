export type ReviewProviderErrorCode =
  | 'AI_NOT_CONFIGURED'
  | 'AI_UNAUTHORIZED'
  | 'AI_BALANCE'
  | 'AI_RATE_LIMITED'
  | 'AI_UNAVAILABLE';

export interface ClassifiedProviderError {
  code: ReviewProviderErrorCode;
  message: string;
  httpStatus: number;
}

const bodyText = (value: unknown): string => {
  try {
    return JSON.stringify(value).toLowerCase();
  } catch {
    return String(value ?? '').toLowerCase();
  }
};

export function classifyDeepSeekError(status: number, body: unknown): ClassifiedProviderError {
  const text = typeof body === 'string' ? body.toLowerCase() : bodyText(body);
  if (
    status === 402 ||
    text.includes('insufficient_balance') ||
    text.includes('insufficient balance') ||
    text.includes('out of credit') ||
    text.includes('balance') && (text.includes('insufficient') || text.includes('not enough') || text.includes('depleted')) ||
    text.includes('quota') && (text.includes('exceeded') || text.includes('insufficient') || text.includes('balance'))
  ) {
    return { code: 'AI_BALANCE', message: 'DeepSeek 余额不足，整理未执行；充值后重试即可，本地记录不受影响。', httpStatus: 402 };
  }
  if (status === 401 || text.includes('invalid_api_key') || text.includes('invalid api key') || text.includes('unauthorized') || text.includes('authentication')) {
    return { code: 'AI_UNAUTHORIZED', message: 'DeepSeek Key 无效或已过期；请检查服务端配置后重试，本地记录不受影响。', httpStatus: 401 };
  }
  if (status === 429 || text.includes('rate_limit') || text.includes('rate limit') || text.includes('too many requests')) {
    return { code: 'AI_RATE_LIMITED', message: 'AI 请求太频繁被限流，稍后重试即可，本地记录不受影响。', httpStatus: 429 };
  }
  return { code: 'AI_UNAVAILABLE', message: 'AI 整理暂时不可用，请稍后重试；本地记录不受影响。', httpStatus: 502 };
}
