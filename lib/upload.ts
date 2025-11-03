// Client-side file upload utility for Hostinger deployment

export interface UploadResult {
  success: boolean;
  url: string;
  filename: string;
  originalName: string;
  size: number;
  mimetype?: string;
  error?: string;
}

/**
 * Upload a file to the server using the /api/upload endpoint
 * @param file - The file to upload
 * @returns Promise with upload result
 */
export const uploadFile = async (file: File): Promise<UploadResult> => {
  try {
    const formData = new FormData();
    formData.append('file', file);

    const response = await fetch('/api/upload', {
      method: 'POST',
      body: formData,
    });

    const result = await response.json();

    if (!response.ok) {
      throw new Error(result.error || 'Upload failed');
    }

    return result;
  } catch (error) {
    console.error('Upload error:', error);
    return {
      success: false,
      url: '',
      filename: '',
      originalName: file.name,
      size: file.size,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
};

/**
 * Upload multiple files
 * @param files - Array of files to upload
 * @returns Promise with array of upload results
 */
export const uploadFiles = async (files: File[]): Promise<UploadResult[]> => {
  const results: UploadResult[] = [];

  for (const file of files) {
    const result = await uploadFile(file);
    results.push(result);
  }

  return results;
};

/**
 * Validate file before upload
 * @param file - File to validate
 * @returns Validation result
 */
export const validateFile = (file: File): { valid: boolean; error?: string } => {
  // Check file type
  const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
  if (!allowedTypes.includes(file.type)) {
    return { valid: false, error: 'Only JPEG, PNG, GIF, and WebP images are allowed' };
  }

  // Check file size (5MB limit)
  const maxSize = 5 * 1024 * 1024; // 5MB
  if (file.size > maxSize) {
    return { valid: false, error: 'File size must be less than 5MB' };
  }

  return { valid: true };
};

/**
 * Get the full URL for a stored file
 * @param relativePath - The relative path returned by upload (e.g., "/uploads/filename.jpg")
 * @returns Full URL
 */
export const getFileUrl = (relativePath: string): string => {
  if (relativePath.startsWith('http')) {
    return relativePath; // Already a full URL
  }
  return `${window.location.origin}${relativePath}`;
};

// Legacy exports for backward compatibility
