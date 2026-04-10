import React from 'react';
import Link from '@mui/material/Link';

const repoGitHubMap = {
    'darwin':  'BillWilliams79/Darwin',
    'sql':     'BillWilliams79/DarwinSQL',
    'rest':    'BillWilliams79/AWS-Lambda-REST-API',
    'cognito': 'BillWilliams79/AWS-Lambda-Cognito-User-Confirmation',
    'jwt':     'BillWilliams79/AWS-JWT-Verification',
};

/**
 * Render a source_ref value as a clickable link (issue or requirement) or plain text.
 * @param {string} sourceRef - e.g. "darwin#79" or "requirement:42" (also accepts legacy "priority:42")
 * @param {function} [navigate] - react-router navigate function (for requirement links)
 * @returns {React.ReactNode}
 */
const renderSourceRef = (sourceRef, navigate) => {
    if (!sourceRef) return '—';

    const requirementMatch = sourceRef.match(/^(priority|requirement):(\d+)$/);
    if (requirementMatch) {
        if (navigate) {
            return (
                <Link component="button" variant="body2"
                      onClick={(e) => { e.stopPropagation(); navigate(`/swarm/requirement/${requirementMatch[2]}`); }}
                      data-testid="source-requirement-link">
                    Requirement #{requirementMatch[2]}
                </Link>
            );
        }
        return `Requirement #${requirementMatch[2]}`;
    }

    const issueMatch = sourceRef.match(/^(.+)#(\d+)$/);
    if (issueMatch) {
        const ghRepo = repoGitHubMap[issueMatch[1]];
        if (ghRepo) {
            return (
                <Link href={`https://github.com/${ghRepo}/issues/${issueMatch[2]}`}
                      target="_blank" rel="noopener noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      data-testid="source-issue-link">
                    {sourceRef}
                </Link>
            );
        }
    }

    return sourceRef;
};

export { repoGitHubMap, renderSourceRef };
