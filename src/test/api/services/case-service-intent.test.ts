/**
 * Intent-Based Query Tests
 *
 * Tests for the intent-based query system to ensure reliable backend routing.
 * Validates that intents are properly constructed, sent, and preserved on retry.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as caseService from '../../../lib/api/services/case-service';
import * as client from '../../../lib/api/client';
import { IntentType } from '../../../lib/api/types';

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

describe('Intent-Based Query System', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const mockResponse = (data: any, ok = true) => ({
    ok,
    status: ok ? 200 : 500,
    json: vi.fn().mockResolvedValue(data),
    headers: new Headers(),
    statusText: ok ? 'OK' : 'Internal Server Error'
  });

  describe('Default Intent Behavior', () => {
    it('should default to CONVERSATION intent when no intent provided', async () => {
      const responseData = {
        content: 'AI Response',
        response_type: 'ANSWER',
        session_id: 'sess-1'
      };
      (client.authenticatedFetchWithRetry as any).mockResolvedValue(mockResponse(responseData));

      const caseId = 'case-123';
      const queryRequest = { query: 'test query', session_id: 'sess-1' };

      await caseService.submitQueryToCase(caseId, queryRequest);

      expect(client.authenticatedFetchWithRetry).toHaveBeenCalledWith(
        `https://api.test/api/v1/cases/${caseId}/queries`,
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            message: queryRequest.query,
            intent: { type: IntentType.Conversation },
            attachments: null
          })
        })
      );
    });

    it('should use explicit intent when provided', async () => {
      const responseData = {
        content: 'Status transition acknowledged',
        response_type: 'ANSWER',
        session_id: 'sess-1'
      };
      (client.authenticatedFetchWithRetry as any).mockResolvedValue(mockResponse(responseData));

      const caseId = 'case-123';
      const queryRequest = {
        query: 'Resolve this case',
        session_id: 'sess-1',
        intent: {
          type: IntentType.StatusTransition,
          from_status: 'investigating',
          to_status: 'resolved',
          user_confirmed: true
        }
      };

      await caseService.submitQueryToCase(caseId, queryRequest);

      expect(client.authenticatedFetchWithRetry).toHaveBeenCalledWith(
        `https://api.test/api/v1/cases/${caseId}/queries`,
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            message: queryRequest.query,
            intent: {
              type: IntentType.StatusTransition,
              from_status: 'investigating',
              to_status: 'resolved',
              user_confirmed: true
            },
            attachments: null
          })
        })
      );
    });
  });

  describe('Intent Type Validation', () => {
    it('should send status_transition intent with all required fields', async () => {
      const responseData = { content: 'OK', response_type: 'ANSWER', session_id: 'sess-1' };
      (client.authenticatedFetchWithRetry as any).mockResolvedValue(mockResponse(responseData));

      const caseId = 'case-123';
      const queryRequest = {
        query: 'Close this case',
        session_id: 'sess-1',
        intent: {
          type: IntentType.StatusTransition,
          from_status: 'inquiry',
          to_status: 'closed',
          user_confirmed: true
        }
      };

      await caseService.submitQueryToCase(caseId, queryRequest);

      const callArgs = (client.authenticatedFetchWithRetry as any).mock.calls[0];
      const body = JSON.parse(callArgs[1].body);

      expect(body.intent).toEqual({
        type: IntentType.StatusTransition,
        from_status: 'inquiry',
        to_status: 'closed',
        user_confirmed: true
      });
    });

    it('should send confirmation intent with confirmation_value', async () => {
      const responseData = { content: 'Confirmed', response_type: 'ANSWER', session_id: 'sess-1' };
      (client.authenticatedFetchWithRetry as any).mockResolvedValue(mockResponse(responseData));

      const caseId = 'case-123';
      const queryRequest = {
        query: 'Yes',
        session_id: 'sess-1',
        intent: {
          type: IntentType.Confirmation,
          confirmation_value: true
        }
      };

      await caseService.submitQueryToCase(caseId, queryRequest);

      const callArgs = (client.authenticatedFetchWithRetry as any).mock.calls[0];
      const body = JSON.parse(callArgs[1].body);

      expect(body.intent).toEqual({
        type: IntentType.Confirmation,
        confirmation_value: true
      });
    });

    it('should send hypothesis_action intent with hypothesis_id and action', async () => {
      const responseData = { content: 'Hypothesis validated', response_type: 'ANSWER', session_id: 'sess-1' };
      (client.authenticatedFetchWithRetry as any).mockResolvedValue(mockResponse(responseData));

      const caseId = 'case-123';
      const queryRequest = {
        query: 'Validate this hypothesis',
        session_id: 'sess-1',
        intent: {
          type: IntentType.HypothesisAction,
          hypothesis_id: 'hyp-456',
          action: 'validate' as const
        }
      };

      await caseService.submitQueryToCase(caseId, queryRequest);

      const callArgs = (client.authenticatedFetchWithRetry as any).mock.calls[0];
      const body = JSON.parse(callArgs[1].body);

      expect(body.intent).toEqual({
        type: IntentType.HypothesisAction,
        hypothesis_id: 'hyp-456',
        action: 'validate'
      });
    });

    it('should send evidence_request intent with evidence_id', async () => {
      const responseData = { content: 'Evidence requested', response_type: 'ANSWER', session_id: 'sess-1' };
      (client.authenticatedFetchWithRetry as any).mockResolvedValue(mockResponse(responseData));

      const caseId = 'case-123';
      const queryRequest = {
        query: 'Show me the logs',
        session_id: 'sess-1',
        intent: {
          type: IntentType.EvidenceRequest,
          evidence_id: 'ev-789'
        }
      };

      await caseService.submitQueryToCase(caseId, queryRequest);

      const callArgs = (client.authenticatedFetchWithRetry as any).mock.calls[0];
      const body = JSON.parse(callArgs[1].body);

      expect(body.intent).toEqual({
        type: IntentType.EvidenceRequest,
        evidence_id: 'ev-789'
      });
    });
  });

  describe('Intent with Attachments', () => {
    it('should include both intent and attachments in request', async () => {
      const responseData = { content: 'Analyzed', response_type: 'ANSWER', session_id: 'sess-1' };
      (client.authenticatedFetchWithRetry as any).mockResolvedValue(mockResponse(responseData));

      const caseId = 'case-123';
      const queryRequest = {
        query: 'Analyze these logs',
        session_id: 'sess-1',
        intent: {
          type: IntentType.Conversation
        },
        context: {
          uploaded_data_ids: ['file-1', 'file-2']
        }
      };

      await caseService.submitQueryToCase(caseId, queryRequest);

      const callArgs = (client.authenticatedFetchWithRetry as any).mock.calls[0];
      const body = JSON.parse(callArgs[1].body);

      expect(body.intent).toEqual({ type: IntentType.Conversation });
      expect(body.attachments).toEqual([
        { file_id: 'file-1' },
        { file_id: 'file-2' }
      ]);
    });
  });

  describe('Enum Values', () => {
    it('should compile IntentType enum to expected string values', () => {
      expect(IntentType.Conversation).toBe('conversation');
      expect(IntentType.StatusTransition).toBe('status_transition');
      expect(IntentType.Confirmation).toBe('confirmation');
      expect(IntentType.HypothesisAction).toBe('hypothesis_action');
      expect(IntentType.EvidenceRequest).toBe('evidence_request');
    });

    it('should use enum values in request body', async () => {
      const responseData = { content: 'OK', response_type: 'ANSWER', session_id: 'sess-1' };
      (client.authenticatedFetchWithRetry as any).mockResolvedValue(mockResponse(responseData));

      const caseId = 'case-123';
      const queryRequest = {
        query: 'test',
        session_id: 'sess-1',
        intent: {
          type: IntentType.Conversation
        }
      };

      await caseService.submitQueryToCase(caseId, queryRequest);

      const callArgs = (client.authenticatedFetchWithRetry as any).mock.calls[0];
      const body = JSON.parse(callArgs[1].body);

      // Verify enum compiles to string value
      expect(body.intent.type).toBe('conversation');
      expect(typeof body.intent.type).toBe('string');
    });
  });

  describe('Error Handling', () => {
    it('should throw error when query is missing', async () => {
      const caseId = 'case-123';
      const queryRequest = { session_id: 'sess-1' } as any;

      await expect(
        caseService.submitQueryToCase(caseId, queryRequest)
      ).rejects.toThrow('Missing required field: query');
    });

    it('should throw error when query is empty string', async () => {
      const caseId = 'case-123';
      const queryRequest = { query: '', session_id: 'sess-1' };

      await expect(
        caseService.submitQueryToCase(caseId, queryRequest)
      ).rejects.toThrow('Missing required field: query');
    });

    it('should throw error when query is only whitespace', async () => {
      const caseId = 'case-123';
      const queryRequest = { query: '   ', session_id: 'sess-1' };

      await expect(
        caseService.submitQueryToCase(caseId, queryRequest)
      ).rejects.toThrow('Missing required field: query');
    });
  });

  describe('Intent Preservation on Retry', () => {
    it('should preserve intent fields when retrying after network failure', async () => {
      const caseId = 'case-123';
      const statusTransitionIntent = {
        type: IntentType.StatusTransition,
        from_status: 'investigating',
        to_status: 'closed',
        user_confirmed: true
      };
      const queryRequest = {
        query: 'Close this case',
        session_id: 'sess-1',
        intent: statusTransitionIntent
      };

      // Simulate retry: first call fails, second succeeds
      let callCount = 0;
      (client.authenticatedFetchWithRetry as any).mockImplementation(async () => {
        callCount++;
        if (callCount === 1) {
          throw new Error('Network error');
        }
        return mockResponse({ content: 'Closed', response_type: 'ANSWER', session_id: 'sess-1' });
      });

      // First attempt fails
      await expect(
        caseService.submitQueryToCase(caseId, queryRequest)
      ).rejects.toThrow('Network error');

      // Verify first call had the intent
      const firstCall = (client.authenticatedFetchWithRetry as any).mock.calls[0];
      const firstBody = JSON.parse(firstCall[1].body);
      expect(firstBody.intent).toEqual(statusTransitionIntent);

      // Retry with same request
      await caseService.submitQueryToCase(caseId, queryRequest);

      // Verify second call preserved the intent
      const secondCall = (client.authenticatedFetchWithRetry as any).mock.calls[1];
      const secondBody = JSON.parse(secondCall[1].body);
      expect(secondBody.intent).toEqual(statusTransitionIntent);
    });

    it('should preserve confirmation intent on retry', async () => {
      const caseId = 'case-123';
      const confirmationIntent = {
        type: IntentType.Confirmation,
        confirmation_value: true
      };
      const queryRequest = {
        query: 'Yes',
        session_id: 'sess-1',
        intent: confirmationIntent
      };

      // Mock successful call
      (client.authenticatedFetchWithRetry as any).mockResolvedValue(
        mockResponse({ content: 'Confirmed', response_type: 'ANSWER', session_id: 'sess-1' })
      );

      await caseService.submitQueryToCase(caseId, queryRequest);

      // Verify intent was sent correctly
      const callArgs = (client.authenticatedFetchWithRetry as any).mock.calls[0];
      const body = JSON.parse(callArgs[1].body);

      expect(body.intent).toEqual(confirmationIntent);
      expect(body.intent.type).toBe(IntentType.Confirmation);
      expect(body.intent.confirmation_value).toBe(true);
    });

    it('should preserve hypothesis_action intent with all fields on retry', async () => {
      const caseId = 'case-123';
      const hypothesisIntent = {
        type: IntentType.HypothesisAction,
        hypothesis_id: 'hyp-789',
        action: 'refute' as const
      };
      const queryRequest = {
        query: 'This hypothesis is incorrect',
        session_id: 'sess-1',
        intent: hypothesisIntent
      };

      (client.authenticatedFetchWithRetry as any).mockResolvedValue(
        mockResponse({ content: 'Hypothesis rejected', response_type: 'ANSWER', session_id: 'sess-1' })
      );

      await caseService.submitQueryToCase(caseId, queryRequest);

      const callArgs = (client.authenticatedFetchWithRetry as any).mock.calls[0];
      const body = JSON.parse(callArgs[1].body);

      expect(body.intent).toEqual(hypothesisIntent);
      expect(body.intent.hypothesis_id).toBe('hyp-789');
      expect(body.intent.action).toBe('refute');
    });

    it('should preserve default CONVERSATION intent on retry when no explicit intent provided', async () => {
      const caseId = 'case-123';
      const queryRequest = {
        query: 'What is causing this error?',
        session_id: 'sess-1'
        // No explicit intent
      };

      (client.authenticatedFetchWithRetry as any).mockResolvedValue(
        mockResponse({ content: 'Let me analyze...', response_type: 'ANSWER', session_id: 'sess-1' })
      );

      await caseService.submitQueryToCase(caseId, queryRequest);

      const callArgs = (client.authenticatedFetchWithRetry as any).mock.calls[0];
      const body = JSON.parse(callArgs[1].body);

      // Verify default intent was added
      expect(body.intent).toEqual({ type: IntentType.Conversation });
    });
  });
});
