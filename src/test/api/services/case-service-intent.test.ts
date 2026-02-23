/**
 * Intent-Based Turn Tests
 *
 * Tests for intent routing via the unified /turns endpoint.
 * Validates that intents are properly sent as FormData fields.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as caseService from '../../../lib/api/services/case-service';
import * as client from '../../../lib/api/client';

// Mock client
vi.mock('../../../lib/api/client', () => ({
  authenticatedFetchWithRetry: vi.fn(),
  authenticatedFetch: vi.fn(),
  prepareBody: (body: unknown) => {
    if (body === undefined || body === null) return undefined;
    return JSON.stringify(body, (_key, value) => value === undefined ? null : value);
  }
}));

// Mock config
vi.mock('../../../config', () => ({
  getApiUrl: vi.fn().mockReturnValue('https://api.test')
}));

describe('Intent-Based Turn System', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const mockTurnResponse = (overrides?: Partial<any>) => ({
    ok: true,
    status: 200,
    json: vi.fn().mockResolvedValue({
      agent_response: 'OK',
      turn_number: 1,
      milestones_completed: [],
      case_status: 'inquiry',
      progress_made: false,
      is_stuck: false,
      attachments_processed: [],
      ...overrides
    }),
    headers: { get: vi.fn() }
  });

  describe('Intent Routing via FormData', () => {
    it('should send conversation intent type', async () => {
      (client.authenticatedFetchWithRetry as any).mockResolvedValue(mockTurnResponse());

      await caseService.submitTurn('case-123', {
        query: 'test query',
        intentType: 'conversation'
      });

      const callArgs = (client.authenticatedFetchWithRetry as any).mock.calls[0];
      const body = callArgs[1].body as FormData;
      expect(body.get('intent_type')).toBe('conversation');
    });

    it('should send status_transition intent with data', async () => {
      (client.authenticatedFetchWithRetry as any).mockResolvedValue(mockTurnResponse());

      await caseService.submitTurn('case-123', {
        query: 'Resolve this case',
        intentType: 'status_transition',
        intentData: {
          from_status: 'investigating',
          to_status: 'resolved',
          user_confirmed: true
        }
      });

      const callArgs = (client.authenticatedFetchWithRetry as any).mock.calls[0];
      const body = callArgs[1].body as FormData;
      expect(body.get('intent_type')).toBe('status_transition');
      expect(JSON.parse(body.get('intent_data') as string)).toEqual({
        from_status: 'investigating',
        to_status: 'resolved',
        user_confirmed: true
      });
    });

    it('should send confirmation intent', async () => {
      (client.authenticatedFetchWithRetry as any).mockResolvedValue(mockTurnResponse());

      await caseService.submitTurn('case-123', {
        query: 'Yes',
        intentType: 'confirmation',
        intentData: { confirmation_value: true }
      });

      const callArgs = (client.authenticatedFetchWithRetry as any).mock.calls[0];
      const body = callArgs[1].body as FormData;
      expect(body.get('intent_type')).toBe('confirmation');
      expect(JSON.parse(body.get('intent_data') as string)).toEqual({
        confirmation_value: true
      });
    });

    it('should send hypothesis_action intent', async () => {
      (client.authenticatedFetchWithRetry as any).mockResolvedValue(mockTurnResponse());

      await caseService.submitTurn('case-123', {
        query: 'Validate this hypothesis',
        intentType: 'hypothesis_action',
        intentData: { hypothesis_id: 'hyp-456', action: 'validate' }
      });

      const callArgs = (client.authenticatedFetchWithRetry as any).mock.calls[0];
      const body = callArgs[1].body as FormData;
      expect(body.get('intent_type')).toBe('hypothesis_action');
      expect(JSON.parse(body.get('intent_data') as string)).toEqual({
        hypothesis_id: 'hyp-456',
        action: 'validate'
      });
    });

    it('should not include intent fields when not provided', async () => {
      (client.authenticatedFetchWithRetry as any).mockResolvedValue(mockTurnResponse());

      await caseService.submitTurn('case-123', { query: 'plain question' });

      const callArgs = (client.authenticatedFetchWithRetry as any).mock.calls[0];
      const body = callArgs[1].body as FormData;
      expect(body.get('intent_type')).toBeNull();
      expect(body.get('intent_data')).toBeNull();
    });
  });

  describe('File Attachments with Intent', () => {
    it('should include both files and intent in FormData', async () => {
      (client.authenticatedFetchWithRetry as any).mockResolvedValue(
        mockTurnResponse({ attachments_processed: [{ evidence_id: 'ev_1', filename: 'log.txt', data_type: 'logs_and_errors', file_size: 100, processing_status: 'completed' }] })
      );

      const mockFile = new File(['log content'], 'log.txt', { type: 'text/plain' });

      await caseService.submitTurn('case-123', {
        query: 'Analyze these logs',
        files: [mockFile],
        intentType: 'conversation'
      });

      const callArgs = (client.authenticatedFetchWithRetry as any).mock.calls[0];
      const body = callArgs[1].body as FormData;
      expect(body.get('query')).toBe('Analyze these logs');
      expect(body.get('intent_type')).toBe('conversation');
      expect(body.get('files')).toBeTruthy();
    });
  });

  describe('Error Handling', () => {
    it('should throw error when turn is empty', async () => {
      await expect(
        caseService.submitTurn('case-123', {})
      ).rejects.toThrow('Turn must include at least one of: query, files, or pastedContent');
    });

    it('should throw error when query is only whitespace', async () => {
      await expect(
        caseService.submitTurn('case-123', { query: '   ' })
      ).rejects.toThrow('Turn must include at least one of: query, files, or pastedContent');
    });
  });
});
