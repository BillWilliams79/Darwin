import { describe, it, expect } from 'vitest';
import { formatBranchLocation } from '../buildLocation';

describe('formatBranchLocation — req #2753', () => {
    it('composes host/project/branch/version with no scheme', () => {
        expect(formatBranchLocation('Darwin', 'main', '1.0.3.0'))
            .toBe('jira.microchip.com/Darwin/main/1.0.3.0');
    });

    it('includes the branch name for non-main branches', () => {
        expect(formatBranchLocation('My App', 'hotfix-1', '2.5.1.1000'))
            .toBe('jira.microchip.com/My App/hotfix-1/2.5.1.1000');
    });

    it('omits the version segment when version is empty (branch with no builds)', () => {
        expect(formatBranchLocation('Darwin', 'main', ''))
            .toBe('jira.microchip.com/Darwin/main');
    });

    it('omits the version segment when version is null/undefined', () => {
        expect(formatBranchLocation('Darwin', 'main', null)).toBe('jira.microchip.com/Darwin/main');
        expect(formatBranchLocation('Darwin', 'main', undefined)).toBe('jira.microchip.com/Darwin/main');
    });

    it('falls back to "project" when the project name is empty', () => {
        expect(formatBranchLocation('', 'main', '1.0.1.0')).toBe('jira.microchip.com/project/main/1.0.1.0');
        expect(formatBranchLocation(null, 'main', '1.0.1.0')).toBe('jira.microchip.com/project/main/1.0.1.0');
    });

    it('falls back to "branch" when the branch name is empty', () => {
        expect(formatBranchLocation('Darwin', '', '1.0.1.0')).toBe('jira.microchip.com/Darwin/branch/1.0.1.0');
        expect(formatBranchLocation('Darwin', null, '1.0.1.0')).toBe('jira.microchip.com/Darwin/branch/1.0.1.0');
    });

    it('flattens embedded newlines and collapses whitespace in branch names', () => {
        expect(formatBranchLocation('Darwin', 'release\n1.0', '1.0.1.0'))
            .toBe('jira.microchip.com/Darwin/release 1.0/1.0.1.0');
    });

    it('trims surrounding whitespace on all segments', () => {
        expect(formatBranchLocation('  Darwin  ', '  main  ', '  1.0.1.0  '))
            .toBe('jira.microchip.com/Darwin/main/1.0.1.0');
    });
});
