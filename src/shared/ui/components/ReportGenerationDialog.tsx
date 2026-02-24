/**
 * Report Generation Dialog Component (FR-CM-006)
 *
 * Provides UI for generating case documentation reports with intelligent
 * runbook recommendations based on vector similarity search.
 *
 * Features:
 * - Intelligent recommendations (reuse/review/generate)
 * - Multi-report selection (Incident Report, Runbook, Post-Mortem)
 * - Progress tracking with generation status
 * - Download functionality for completed reports
 */

import React, { useState, useEffect } from 'react';
import {
  ReportRecommendation,
  ReportType,
  CaseReport,
  getReportRecommendations,
  generateReports,
  downloadReport
} from '../../../lib/api';

interface ReportGenerationDialogProps {
  caseId: string;
  caseTitle: string;
  isOpen: boolean;
  onClose: () => void;
  onReportsGenerated?: (reports: CaseReport[]) => void;
}

export function ReportGenerationDialog({
  caseId,
  caseTitle,
  isOpen,
  onClose,
  onReportsGenerated
}: ReportGenerationDialogProps) {
  const [recommendations, setRecommendations] = useState<ReportRecommendation | null>(null);
  const [selectedReports, setSelectedReports] = useState<ReportType[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatedReports, setGeneratedReports] = useState<CaseReport[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Fetch recommendations when dialog opens
  useEffect(() => {
    if (isOpen && !recommendations) {
      fetchRecommendations();
    }
  }, [isOpen, caseId]);

  const fetchRecommendations = async () => {
    setIsLoading(true);
    setError(null);

    try {
      const recs = await getReportRecommendations(caseId);
      setRecommendations(recs);

      // Pre-select all available reports by default
      setSelectedReports(recs.available_for_generation);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch recommendations');
    } finally {
      setIsLoading(false);
    }
  };

  const handleToggleReport = (reportType: ReportType) => {
    setSelectedReports(prev =>
      prev.includes(reportType)
        ? prev.filter(r => r !== reportType)
        : [...prev, reportType]
    );
  };

  const handleGenerate = async () => {
    if (selectedReports.length === 0) {
      setError('Please select at least one report to generate');
      return;
    }

    setIsGenerating(true);
    setError(null);

    try {
      const response = await generateReports(caseId, {
        report_types: selectedReports
      });

      setGeneratedReports(response.reports);

      // Notify parent component
      if (onReportsGenerated) {
        onReportsGenerated(response.reports);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate reports');
    } finally {
      setIsGenerating(false);
    }
  };

  const handleDownload = async (report: CaseReport) => {
    try {
      const blob = await downloadReport(caseId, report.report_id);

      // Create download link
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${report.title.replace(/[^a-z0-9]/gi, '_').toLowerCase()}.md`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to download report');
    }
  };

  const getReportLabel = (reportType: ReportType): string => {
    switch (reportType) {
      case 'incident_report':
        return 'Incident Report';
      case 'runbook':
        return 'Runbook';
      case 'post_mortem':
        return 'Post-Mortem';
      default:
        return reportType;
    }
  };

  const getRunbookRecommendationUI = () => {
    if (!recommendations?.runbook_recommendation) return null;

    const { action, similarity_score, reason, existing_runbook } = recommendations.runbook_recommendation;

    const actionColors = {
      reuse: 'bg-fm-green-light border-fm-green-border text-fm-green',
      review_or_generate: 'bg-fm-yellow-light border-fm-yellow-border text-fm-yellow',
      generate: 'bg-fm-blue-light border-fm-blue-border text-fm-blue'
    };

    const actionIcons = {
      reuse: '♻️',
      review_or_generate: '🔍',
      generate: '✨'
    };

    return (
      <div className={`p-4 rounded-lg border-2 mb-4 ${actionColors[action]}`}>
        <div className="flex items-start gap-3">
          <span className="text-2xl">{actionIcons[action]}</span>
          <div className="flex-1">
            <h4 className="font-semibold mb-1">
              Runbook Recommendation: {action === 'reuse' ? 'Reuse Existing' : action === 'review_or_generate' ? 'Review or Generate' : 'Generate New'}
            </h4>
            <p className="text-sm mb-2">{reason}</p>
            {similarity_score !== undefined && (
              <p className="text-xs opacity-75">
                Similarity: {(similarity_score * 100).toFixed(1)}%
              </p>
            )}
            {existing_runbook && action === 'reuse' && (
              <div className="mt-2 p-2 bg-fm-surface bg-opacity-50 rounded text-xs">
                <strong>Existing Runbook:</strong> {existing_runbook.title}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-fm-surface rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="sticky top-0 bg-fm-surface border-b px-6 py-4 flex justify-between items-center">
          <h2 className="text-xl font-bold text-white">
            Generate Case Documentation
          </h2>
          <button
            onClick={onClose}
            className="text-fm-muted hover:text-fm-text text-2xl leading-none"
            aria-label="Close dialog"
          >
            ×
          </button>
        </div>

        {/* Body */}
        <div className="p-6">
          <p className="text-sm text-fm-dim mb-4">
            Case: <strong>{caseTitle}</strong>
          </p>

          {isLoading && (
            <div className="text-center py-8">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-fm-blue mx-auto mb-4"></div>
              <p className="text-fm-dim">Loading recommendations...</p>
            </div>
          )}

          {error && (
            <div className="bg-fm-red-light border border-fm-border text-fm-red px-4 py-3 rounded mb-4">
              {error}
            </div>
          )}

          {recommendations && !generatedReports.length && (
            <>
              {/* Runbook Recommendation */}
              {getRunbookRecommendationUI()}

              {/* Report Selection */}
              <div className="mb-6">
                <h3 className="font-semibold text-white mb-3">
                  Select Reports to Generate
                </h3>
                <div className="space-y-2">
                  {recommendations.available_for_generation.map(reportType => (
                    <label
                      key={reportType}
                      className="flex items-center gap-3 p-3 border rounded-lg hover:bg-fm-surface cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        checked={selectedReports.includes(reportType)}
                        onChange={() => handleToggleReport(reportType)}
                        className="w-4 h-4 text-fm-blue"
                      />
                      <span className="flex-1 font-medium text-white">
                        {getReportLabel(reportType)}
                      </span>
                    </label>
                  ))}
                </div>
              </div>

              {/* Actions */}
              <div className="flex gap-3 justify-end">
                <button
                  onClick={onClose}
                  className="px-4 py-2 text-fm-text hover:bg-fm-surface rounded-lg"
                >
                  Cancel
                </button>
                <button
                  onClick={handleGenerate}
                  disabled={isGenerating || selectedReports.length === 0}
                  className="px-4 py-2 bg-fm-blue text-white rounded-lg hover:bg-fm-active disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isGenerating ? 'Generating...' : `Generate ${selectedReports.length} Report${selectedReports.length !== 1 ? 's' : ''}`}
                </button>
              </div>
            </>
          )}

          {/* Generated Reports */}
          {generatedReports.length > 0 && (
            <div className="space-y-4">
              <div className="bg-fm-green-light border border-fm-green-border text-fm-green px-4 py-3 rounded mb-4">
                ✅ Successfully generated {generatedReports.length} report{generatedReports.length !== 1 ? 's' : ''}
              </div>

              {generatedReports.map(report => (
                <div key={report.report_id} className="border rounded-lg p-4">
                  <div className="flex justify-between items-start mb-2">
                    <div>
                      <h4 className="font-semibold text-white">{report.title}</h4>
                      <p className="text-sm text-fm-dim">
                        {getReportLabel(report.report_type)} • Generated {new Date(report.generated_at).toLocaleString()}
                      </p>
                    </div>
                    <button
                      onClick={() => handleDownload(report)}
                      className="px-3 py-1 bg-fm-blue text-white text-sm rounded hover:bg-fm-active"
                    >
                      Download
                    </button>
                  </div>
                </div>
              ))}

              <div className="flex justify-end pt-4">
                <button
                  onClick={onClose}
                  className="px-4 py-2 bg-fm-elevated text-fm-text rounded-lg hover:bg-fm-elevated"
                >
                  Done
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
