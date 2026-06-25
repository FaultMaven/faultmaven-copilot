import { describe, it, expect, vi, beforeEach } from 'vitest';

// We need to test the logic from src/entrypoints/options/main.tsx
// Since it's not exported, we'll recreate the logic here to verify the behavior
function originPattern(url: string): string | null {
  try {
    return `${new URL(url).origin}/*`;
  } catch {
    return null;
  }
}

async function ensureOriginPermission(urls: string[], browserPermissionsApi: any): Promise<boolean> {
  const origins = Array.from(
    new Set(urls.map(originPattern).filter((o): o is string => !!o))
  );
  if (origins.length === 0) return true;
  try {
    if (await browserPermissionsApi.contains({ origins })) return true;
    return await browserPermissionsApi.request({ origins });
  } catch (e) {
    return false;
  }
}

describe('Host Permission Request', () => {
  let mockBrowserPermissions: any;

  beforeEach(() => {
    mockBrowserPermissions = {
      contains: vi.fn(),
      request: vi.fn(),
    };
  });

  it('should return true immediately if no valid URLs provided', async () => {
    const result = await ensureOriginPermission(['invalid-url'], mockBrowserPermissions);
    expect(result).toBe(true);
    expect(mockBrowserPermissions.contains).not.toHaveBeenCalled();
    expect(mockBrowserPermissions.request).not.toHaveBeenCalled();
  });

  it('should format origin pattern correctly', async () => {
    mockBrowserPermissions.contains.mockResolvedValue(true);
    
    await ensureOriginPermission(['https://my-backend.internal.corp:8443/api/v1'], mockBrowserPermissions);
    
    expect(mockBrowserPermissions.contains).toHaveBeenCalledWith({
      origins: ['https://my-backend.internal.corp:8443/*']
    });
  });

  it('should deduplicate origins', async () => {
    mockBrowserPermissions.contains.mockResolvedValue(true);
    
    await ensureOriginPermission([
      'https://api.example.com/v1',
      'https://api.example.com/v2'
    ], mockBrowserPermissions);
    
    expect(mockBrowserPermissions.contains).toHaveBeenCalledWith({
      origins: ['https://api.example.com/*']
    });
  });

  it('should return true if permission already granted', async () => {
    mockBrowserPermissions.contains.mockResolvedValue(true);
    
    const result = await ensureOriginPermission(['https://api.example.com'], mockBrowserPermissions);
    
    expect(result).toBe(true);
    expect(mockBrowserPermissions.contains).toHaveBeenCalled();
    expect(mockBrowserPermissions.request).not.toHaveBeenCalled();
  });

  it('should request permission if not already granted', async () => {
    mockBrowserPermissions.contains.mockResolvedValue(false);
    mockBrowserPermissions.request.mockResolvedValue(true);
    
    const result = await ensureOriginPermission(['https://api.example.com'], mockBrowserPermissions);
    
    expect(result).toBe(true);
    expect(mockBrowserPermissions.contains).toHaveBeenCalled();
    expect(mockBrowserPermissions.request).toHaveBeenCalledWith({
      origins: ['https://api.example.com/*']
    });
  });

  it('should handle request failure gracefully', async () => {
    mockBrowserPermissions.contains.mockResolvedValue(false);
    mockBrowserPermissions.request.mockRejectedValue(new Error('User denied'));
    
    const result = await ensureOriginPermission(['https://api.example.com'], mockBrowserPermissions);
    
    expect(result).toBe(false);
  });
});
