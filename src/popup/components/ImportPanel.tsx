import React, { useState, useRef, useCallback } from 'react';
import {
  Box,
  Paper,
  Typography,
  Button,
  List,
  ListItem,
  ListItemIcon,
  ListItemText,
  Chip,
  Card,
  CardContent,
  Tooltip,
  Collapse,
  Avatar,
  Stack,
  Zoom,
  IconButton,
} from '@mui/material';
import {
  CloudUpload,
  InsertDriveFile,
  Description,
  Code,
  Api,
  Visibility,
  FileUpload,
  GetApp,
  AutoAwesome,
} from '@mui/icons-material';
import { useStore } from '@/store/useStore';
import ImportProgressComponent from './ImportProgress';
import FilePreviewCard from './FilePreviewCard';
import ImportHistory from './ImportHistory';

interface ImportState {
  isImporting: boolean;
  progress: number;
  stage: string;
  currentFile?: string;
}

interface ImportedFile {
  name: string;
  type: 'har' | 'postman' | 'openapi' | 'insomnia';
  size: number;
  endpointCount?: number;
  status: 'processing' | 'success' | 'error';
  error?: string;
  sessionId?: string;
  preview?: {
    endpoints: number;
    methods: string[];
    domains: string[];
  };
}

interface FilePreview {
  file: File;
  type: string;
  preview: {
    endpoints: number;
    methods: string[];
    domains: string[];
  };
}

export default function ImportPanel() {
  const { importSession, sessions } = useStore();
  const [importState, setImportState] = useState<ImportState>({
    isImporting: false,
    progress: 0,
    stage: '',
  });
  const [importedFiles, setImportedFiles] = useState<ImportedFile[]>([]);
  const [isDragOver, setIsDragOver] = useState(false);
  const [filePreview, setFilePreview] = useState<FilePreview | null>(null);
  const [showExamples, setShowExamples] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files || files.length === 0) return;

    // Preview first file if single file selected
    if (files.length === 1) {
      await previewFile(files[0]);
    } else {
      // Process multiple files directly
      for (const file of Array.from(files)) {
        await processFile(file);
      }
    }

    // Clear the input
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  // Enhanced drag & drop handlers
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
  }, []);

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);

    const files = Array.from(e.dataTransfer.files);
    if (files.length === 0) return;

    // Preview first file if single file dropped
    if (files.length === 1) {
      await previewFile(files[0]);
    } else {
      // Process multiple files directly
      for (const file of files) {
        await processFile(file);
      }
    }
  }, []);

  // File preview functionality
  const previewFile = async (file: File): Promise<void> => {
    try {
      const content = await readFileContent(file);
      const type = detectFileType(file);
      const preview = await generateFilePreview(content, type);

      setFilePreview({
        file,
        type,
        preview,
      });
    } catch (error) {
      console.error('Preview error:', error);
      // If preview fails, process directly
      await processFile(file);
    }
  };

  // Generate file preview without full processing
  const generateFilePreview = async (content: string, type: string) => {
    try {
      let endpoints = 0;
      let methods: string[] = [];
      let domains: string[] = [];

      switch (type) {
        case 'har':
          const harData = JSON.parse(content);
          if (harData.log?.entries) {
            endpoints = harData.log.entries.length;
            methods = [...new Set(harData.log.entries.map((e: any) => e.request.method))] as string[];
            domains = [...new Set(harData.log.entries.map((e: any) => {
              try { return new URL(e.request.url).hostname; } catch { return 'unknown'; }
            }))] as string[];
          }
          break;

        case 'postman':
          const collection = JSON.parse(content);
          const items = [];
          const processItems = (itemList: any[]) => {
            itemList.forEach((item: any) => {
              if (item.item) processItems(item.item);
              else if (item.request) items.push(item.request);
            });
          };
          if (collection.item) processItems(collection.item);
          endpoints = items.length;
          methods = [...new Set(items.map((item: any) => item.method))];
          domains = [...new Set(items.map((item: any) => {
            const url = typeof item.url === 'string' ? item.url : item.url?.raw || '';
            try { return new URL(url).hostname; } catch { return 'unknown'; }
          }))];
          break;

        case 'openapi':
          const spec = JSON.parse(content);
          if (spec.paths) {
            Object.entries(spec.paths).forEach(([path, pathMethods]: [string, any]) => {
              Object.keys(pathMethods).forEach(method => {
                if (['get', 'post', 'put', 'delete', 'patch', 'head', 'options'].includes(method.toLowerCase())) {
                  endpoints++;
                  methods.push(method.toUpperCase());
                }
              });
            });
            methods = [...new Set(methods)];
            domains = spec.servers?.map((s: any) => {
              try { return new URL(s.url).hostname; } catch { return 'api.example.com'; }
            }) || ['api.example.com'];
          }
          break;

        case 'insomnia':
          const data = JSON.parse(content);
          const requests = data.resources?.filter((r: any) => r._type === 'request') || [];
          endpoints = requests.length;
          methods = [...new Set(requests.map((r: any) => r.method))] as string[];
          domains = [...new Set(requests.map((r: any) => {
            try { return new URL(r.url).hostname; } catch { return 'unknown'; }
          }))] as string[];
          break;
      }

      return { endpoints, methods: methods.slice(0, 5), domains: domains.slice(0, 3) };
    } catch (error) {
      return { endpoints: 0, methods: [], domains: [] };
    }
  };

  const confirmImport = async () => {
    if (filePreview) {
      await processFile(filePreview.file);
      setFilePreview(null);
    }
  };

  const cancelPreview = () => {
    setFilePreview(null);
  };

  const processFile = async (file: File): Promise<void> => {
    const fileType = detectFileType(file);

    // Add file to processing list
    const newFile: ImportedFile = {
      name: file.name,
      type: fileType,
      size: file.size,
      status: 'processing',
    };

    setImportedFiles(prev => [...prev, newFile]);

    setImportState({
      isImporting: true,
      progress: 10,
      stage: `Processing ${file.name}...`,
      currentFile: file.name,
    });

    try {
      // Read file content
      const content = await readFileContent(file);

      setImportState(prev => ({
        ...prev,
        progress: 30,
        stage: `Parsing ${fileType.toUpperCase()} format...`,
      }));

      // Parse based on file type
      let sessionData;
      switch (fileType) {
        case 'har':
          sessionData = await parseHARFile(content);
          break;
        case 'postman':
          sessionData = await parsePostmanCollection(content);
          break;
        case 'openapi':
          sessionData = await parseOpenAPISpec(content);
          break;
        case 'insomnia':
          sessionData = await parseInsomniaExport(content);
          break;
        default:
          throw new Error(`Unsupported file type: ${fileType}`);
      }

      setImportState(prev => ({
        ...prev,
        progress: 70,
        stage: 'Creating session...',
      }));

      // Create session from parsed data
      const sessionId = await importSession(sessionData);

      setImportState(prev => ({
        ...prev,
        progress: 100,
        stage: 'Import completed successfully!',
      }));

      // Update file status
      setImportedFiles(prev => prev.map(f =>
        f.name === file.name
          ? {
              ...f,
              status: 'success',
              endpointCount: sessionData.requests.length,
              sessionId
            }
          : f
      ));

      // Reset state after delay
      setTimeout(() => {
        setImportState({
          isImporting: false,
          progress: 0,
          stage: '',
        });
      }, 2000);

    } catch (error) {
      console.error('Import error:', error);

      setImportedFiles(prev => prev.map(f =>
        f.name === file.name
          ? {
              ...f,
              status: 'error',
              error: error instanceof Error ? error.message : 'Unknown error'
            }
          : f
      ));

      setImportState({
        isImporting: false,
        progress: 0,
        stage: '',
      });
    }
  };

  const detectFileType = (file: File): 'har' | 'postman' | 'openapi' | 'insomnia' => {
    const name = file.name.toLowerCase();

    if (name.endsWith('.har')) return 'har';
    if (name.includes('postman') || name.endsWith('.postman_collection.json')) return 'postman';
    if (name.includes('insomnia') || name.endsWith('.insomnia.json')) return 'insomnia';
    if (name.includes('swagger') || name.includes('openapi') || name.endsWith('.yaml') || name.endsWith('.yml')) return 'openapi';

    // Default to HAR for .json files
    return 'har';
  };

  const readFileContent = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => resolve(e.target?.result as string);
      reader.onerror = (e) => reject(new Error('Failed to read file'));
      reader.readAsText(file);
    });
  };

  const parseHARFile = async (content: string) => {
    try {
      if (!content || content.trim().length === 0) {
        throw new Error('HAR file is empty');
      }

      const harData = JSON.parse(content);

      // Check for various possible HAR formats
      if (!harData) {
        throw new Error('Invalid JSON format');
      }

      // Handle different HAR file structures
      let entries;
      if (harData.log && harData.log.entries) {
        entries = harData.log.entries;
      } else if (harData.entries) {
        entries = harData.entries;
      } else if (Array.isArray(harData)) {
        entries = harData;
      } else {
        throw new Error('HAR file missing required entries. Expected structure: { log: { entries: [...] } }');
      }

      if (!Array.isArray(entries) || entries.length === 0) {
        throw new Error('HAR file contains no network requests');
      }

      const requests = entries.map((entry: any, index: number) => {
        try {
          // Validate required fields
          if (!entry.request || !entry.response) {
            console.warn(`Skipping entry ${index}: Missing request or response`);
            return null;
          }

          if (!entry.request.method || !entry.request.url) {
            console.warn(`Skipping entry ${index}: Missing method or URL`);
            return null;
          }

          return {
            id: `har-${index}`,
            method: entry.request.method,
            url: entry.request.url,
            status: entry.response.status || 0,
            type: entry._resourceType || 'XHR',
            requestHeaders: entry.request.headers || [],
            responseHeaders: entry.response.headers || [],
            requestBody: entry.request.postData?.text,
            responseBody: entry.response.content?.text,
            responseSize: entry.response.content?.size || entry.response.bodySize || 0,
            timestamp: entry.startedDateTime ? new Date(entry.startedDateTime).getTime() : Date.now(),
            duration: entry.time || 0,
          };
        } catch (entryError) {
          console.warn(`Error parsing entry ${index}:`, entryError);
          return null;
        }
      }).filter(Boolean); // Remove null entries

      if (requests.length === 0) {
        throw new Error('No valid network requests found in HAR file');
      }

      return {
        name: `Imported HAR - ${new Date().toLocaleString()}`,
        requests,
        metadata: {
          source: 'har_import',
          originalFile: 'har_file',
          importedAt: Date.now(),
        },
      };
    } catch (error) {
      throw new Error(`Failed to parse HAR file: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  };

  const parsePostmanCollection = async (content: string) => {
    try {
      if (!content || content.trim().length === 0) {
        throw new Error('Postman collection file is empty');
      }

      const collection = JSON.parse(content);

      if (!collection) {
        throw new Error('Invalid JSON format');
      }

      // Handle different Postman collection formats
      let items;
      if (collection.item) {
        items = collection.item;
      } else if (collection.requests) {
        items = collection.requests;
      } else if (Array.isArray(collection)) {
        items = collection;
      } else {
        throw new Error('Postman collection missing required items. Expected structure: { item: [...] } or { requests: [...] }');
      }

      if (!Array.isArray(items) || items.length === 0) {
        throw new Error('Postman collection contains no requests');
      }

      const requests: any[] = [];

      const processItems = (items: any[], folderName = '', depth = 0) => {
        if (depth > 10) {
          console.warn('Maximum folder depth reached, skipping nested items');
          return;
        }

        items.forEach((item: any, index: number) => {
          try {
            if (item.item && Array.isArray(item.item)) {
              // This is a folder
              processItems(item.item, item.name || folderName, depth + 1);
            } else if (item.request) {
              // This is a request
              const request = item.request;

              if (!request.method) {
                console.warn(`Skipping request ${index}: Missing method`);
                return;
              }

              let url = '';
              if (typeof request.url === 'string') {
                url = request.url;
              } else if (request.url?.raw) {
                url = request.url.raw;
              } else if (request.url?.host && request.url?.path) {
                const host = Array.isArray(request.url.host) ? request.url.host.join('.') : request.url.host;
                const path = Array.isArray(request.url.path) ? request.url.path.join('/') : request.url.path;
                const protocol = request.url.protocol || 'https';
                url = `${protocol}://${host}/${path}`;
              }

              if (!url) {
                console.warn(`Skipping request ${index}: Missing URL`);
                return;
              }

              requests.push({
                id: item.id || item._postman_id || `postman_${requests.length}`,
                method: request.method.toUpperCase(),
                url: url,
                type: 'XHR',
                status: 200, // Default status for imported requests
                requestHeaders: request.header || [],
                responseHeaders: [],
                requestBody: request.body?.raw || request.body?.urlencoded || request.body?.formdata,
                responseBody: '',
                responseSize: 0,
                timestamp: Date.now(),
                duration: 0,
                metadata: {
                  folder: folderName,
                  name: item.name,
                  description: item.description
                }
              });
            } else if (item.method && item.url) {
              // Handle legacy Postman format (direct request objects)
              requests.push({
                id: item.id || `postman_${requests.length}`,
                method: item.method.toUpperCase(),
                url: item.url,
                type: 'XHR',
                status: 200,
                requestHeaders: item.headers || [],
                responseHeaders: [],
                requestBody: item.data,
                responseBody: '',
                responseSize: 0,
                timestamp: Date.now(),
                duration: 0,
                metadata: {
                  folder: folderName,
                  name: item.name
                }
              });
            }
          } catch (itemError) {
            console.warn(`Error processing item ${index}:`, itemError);
          }
        });
      };

      processItems(items);

      if (requests.length === 0) {
        throw new Error('No valid requests found in Postman collection');
      }

      return {
        name: `Imported Postman - ${collection.info?.name || 'Collection'} - ${new Date().toLocaleString()}`,
        requests,
        metadata: {
          source: 'postman_import',
          originalFile: 'postman_collection',
          importedAt: Date.now(),
          collectionName: collection.info?.name,
        },
      };
    } catch (error) {
      throw new Error(`Failed to parse Postman collection: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  };

  const parseOpenAPISpec = async (content: string) => {
    try {
      const spec = JSON.parse(content);

      if (!spec.paths) {
        throw new Error('Invalid OpenAPI specification format');
      }

      const requests: any[] = [];
      const baseUrl = spec.servers?.[0]?.url || 'https://api.example.com';

      Object.entries(spec.paths).forEach(([path, methods]: [string, any]) => {
        Object.entries(methods).forEach(([method, operation]: [string, any]) => {
          if (['get', 'post', 'put', 'delete', 'patch', 'head', 'options'].includes(method.toLowerCase())) {
            requests.push({
              id: operation.operationId || `${method}_${path.replace(/\W/g, '_')}`,
              method: method.toUpperCase(),
              url: `${baseUrl}${path}`,
              status: 200,
              requestHeaders: [],
              responseHeaders: [],
              requestBody: operation.requestBody ? JSON.stringify(operation.requestBody.content?.['application/json']?.example || {}) : '',
              responseBody: JSON.stringify(operation.responses?.['200']?.content?.['application/json']?.example || {}),
              timestamp: Date.now(),
              duration: 0,
              operationId: operation.operationId,
              summary: operation.summary,
            });
          }
        });
      });

      return {
        name: `Imported OpenAPI - ${spec.info?.title || 'API'} - ${new Date().toLocaleString()}`,
        requests,
        metadata: {
          source: 'openapi_import',
          originalFile: 'openapi_spec',
          importedAt: Date.now(),
          apiTitle: spec.info?.title,
          apiVersion: spec.info?.version,
        },
      };
    } catch (error) {
      throw new Error(`Failed to parse OpenAPI specification: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  };

  const parseInsomniaExport = async (content: string) => {
    try {
      const data = JSON.parse(content);

      if (!data.resources) {
        throw new Error('Invalid Insomnia export format');
      }

      const requests = data.resources
        .filter((resource: any) => resource._type === 'request')
        .map((request: any) => ({
          id: request._id,
          method: request.method,
          url: request.url,
          status: 200,
          requestHeaders: request.headers || [],
          responseHeaders: [],
          requestBody: request.body?.text,
          responseBody: '',
          timestamp: Date.now(),
          duration: 0,
          name: request.name,
        }));

      return {
        name: `Imported Insomnia - ${new Date().toLocaleString()}`,
        requests,
        metadata: {
          source: 'insomnia_import',
          originalFile: 'insomnia_export',
          importedAt: Date.now(),
        },
      };
    } catch (error) {
      throw new Error(`Failed to parse Insomnia export: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  };

  const removeImportedFile = (fileName: string) => {
    setImportedFiles(prev => prev.filter(f => f.name !== fileName));
  };

  return (
    <Box>
      {/* Enhanced Drag & Drop Zone */}
      <Paper
        elevation={isDragOver ? 8 : 2}
        sx={{
          p: 4,
          mb: 3,
          textAlign: 'center',
          position: 'relative',
          border: isDragOver ? '3px dashed #2196f3' : '2px dashed #e0e0e0',
          bgcolor: isDragOver ? 'rgba(33, 150, 243, 0.05)' : 'background.paper',
          transition: 'all 0.3s ease',
          cursor: 'pointer',
          '&:hover': {
            border: '2px dashed #2196f3',
            bgcolor: 'rgba(33, 150, 243, 0.02)',
            transform: 'translateY(-2px)',
            boxShadow: 6,
          }
        }}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={handleFileSelect}
      >
        <input
          type="file"
          ref={fileInputRef}
          onChange={handleFileChange}
          multiple
          accept=".har,.json,.yaml,.yml"
          style={{ display: 'none' }}
        />

        <Zoom in={true} style={{ transitionDelay: '100ms' }}>
          <Box>
            <Avatar
              sx={{
                width: 80,
                height: 80,
                bgcolor: isDragOver ? 'primary.main' : 'primary.light',
                mb: 2,
                mx: 'auto',
                transition: 'all 0.3s ease',
                transform: isDragOver ? 'scale(1.1)' : 'scale(1)',
              }}
            >
              {isDragOver ? (
                <GetApp sx={{ fontSize: 40 }} />
              ) : (
                <FileUpload sx={{ fontSize: 40 }} />
              )}
            </Avatar>

            <Typography variant="h5" gutterBottom sx={{ fontWeight: 600, color: isDragOver ? 'primary.main' : 'text.primary' }}>
              {isDragOver ? 'Drop Your Files Here' : 'Import API Data'}
            </Typography>

            <Typography variant="body1" color="text.secondary" sx={{ mb: 3, maxWidth: 280, mx: 'auto' }}>
              {isDragOver
                ? 'Release to import your files'
                : 'Drag & drop files or click to browse'}
            </Typography>

            {!isDragOver && (
              <Button
                variant="contained"
                size="large"
                startIcon={<CloudUpload />}
                disabled={importState.isImporting}
                sx={{
                  mb: 3,
                  px: 4,
                  py: 1.5,
                  borderRadius: 3,
                  boxShadow: 3,
                  '&:hover': {
                    boxShadow: 6,
                    transform: 'translateY(-1px)',
                  }
                }}
              >
                {importState.isImporting ? 'Processing...' : 'Browse Files'}
              </Button>
            )}

            {/* Animated file type indicators */}
            <Stack direction="row" spacing={1} justifyContent="center" flexWrap="wrap" useFlexGap>
              {[
                { label: 'HAR', icon: <InsertDriveFile />, color: '#4caf50' },
                { label: 'Postman', icon: <Api />, color: '#ff9800' },
                { label: 'OpenAPI', icon: <Description />, color: '#2196f3' },
                { label: 'Insomnia', icon: <Code />, color: '#9c27b0' },
              ].map((type, index) => (
                <Zoom key={type.label} in={true} style={{ transitionDelay: `${200 + index * 100}ms` }}>
                  <Chip
                    label={type.label}
                    variant="outlined"
                    size="small"
                    icon={type.icon}
                    sx={{
                      borderColor: type.color,
                      color: type.color,
                      '&:hover': {
                        bgcolor: `${type.color}10`,
                        transform: 'scale(1.05)',
                      }
                    }}
                  />
                </Zoom>
              ))}
            </Stack>
          </Box>
        </Zoom>

        {/* Quick Actions */}
        <Box sx={{ position: 'absolute', top: 16, right: 16 }}>
          <Tooltip title="View Examples">
            <IconButton
              size="small"
              onClick={(e) => {
                e.stopPropagation();
                setShowExamples(!showExamples);
              }}
              sx={{ bgcolor: 'background.paper', boxShadow: 1 }}
            >
              <Visibility />
            </IconButton>
          </Tooltip>
        </Box>
      </Paper>

      {/* Examples Section */}
      <Collapse in={showExamples}>
        <Card sx={{ mb: 3, bgcolor: 'primary.50' }}>
          <CardContent>
            <Typography variant="h6" gutterBottom sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <AutoAwesome color="primary" />
              Example Files & Templates
            </Typography>
            <Box sx={{ display: 'flex', gap: 2 }}>
              <Button
                variant="outlined"
                size="small"
                fullWidth
                startIcon={<GetApp />}
                onClick={() => {
                  const blob = new Blob([JSON.stringify(sampleHAR, null, 2)], { type: 'application/json' });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement('a');
                  a.href = url;
                  a.download = 'sample.har';
                  a.click();
                  URL.revokeObjectURL(url);
                }}
              >
                Sample HAR
              </Button>
              <Button
                variant="outlined"
                size="small"
                fullWidth
                startIcon={<GetApp />}
                onClick={() => {
                  const blob = new Blob([JSON.stringify(samplePostman, null, 2)], { type: 'application/json' });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement('a');
                  a.href = url;
                  a.download = 'sample-collection.json';
                  a.click();
                  URL.revokeObjectURL(url);
                }}
              >
                Postman Collection
              </Button>
            </Box>
          </CardContent>
        </Card>
      </Collapse>

      {/* File Preview Dialog */}
      {filePreview && (
        <FilePreviewCard
          filePreview={filePreview}
          onConfirm={confirmImport}
          onCancel={cancelPreview}
        />
      )}

      {/* Enhanced Import Progress */}
      <ImportProgressComponent importState={importState} />

      {/* Imported Files List */}
      <ImportHistory importedFiles={importedFiles} onRemoveFile={removeImportedFile} />

      {/* Help Section */}
      <Paper elevation={1} sx={{ p: 2 }}>
        <Typography variant="subtitle2" gutterBottom>
          Supported Formats
        </Typography>
        <List dense>
          <ListItem>
            <ListItemIcon><InsertDriveFile fontSize="small" /></ListItemIcon>
            <ListItemText
              primary="HAR Files (.har)"
              secondary="HTTP Archive files from browser DevTools or proxy tools"
            />
          </ListItem>
          <ListItem>
            <ListItemIcon><Api fontSize="small" /></ListItemIcon>
            <ListItemText
              primary="Postman Collections (.json)"
              secondary="Exported Postman collections with requests and folders"
            />
          </ListItem>
          <ListItem>
            <ListItemIcon><Description fontSize="small" /></ListItemIcon>
            <ListItemText
              primary="OpenAPI/Swagger (.json/.yaml)"
              secondary="API specifications with endpoints and schemas"
            />
          </ListItem>
          <ListItem>
            <ListItemIcon><Code fontSize="small" /></ListItemIcon>
            <ListItemText
              primary="Insomnia Exports (.json)"
              secondary="Exported request collections from Insomnia REST client"
            />
          </ListItem>
        </List>
      </Paper>
    </Box>
  );
}

// Sample data for examples
const sampleHAR = {
  log: {
    version: "1.2",
    creator: { name: "XHRScribe Sample", version: "1.0" },
    entries: [
      {
        _resourceType: "xhr",
        startedDateTime: "2024-01-15T10:30:00.000Z",
        time: 150,
        request: {
          method: "GET",
          url: "https://jsonplaceholder.typicode.com/posts/1",
          httpVersion: "HTTP/1.1",
          headers: [{ name: "Accept", value: "application/json" }],
          queryString: [],
          cookies: [],
          headersSize: -1,
          bodySize: 0
        },
        response: {
          status: 200,
          statusText: "OK",
          httpVersion: "HTTP/1.1",
          headers: [{ name: "Content-Type", value: "application/json; charset=utf-8" }],
          cookies: [],
          content: {
            size: 292,
            mimeType: "application/json",
            text: '{"userId":1,"id":1,"title":"Sample Post","body":"Sample content"}'
          },
          redirectURL: "",
          headersSize: -1,
          bodySize: 292
        },
        cache: {},
        timings: { blocked: -1, dns: -1, connect: -1, send: 0, wait: 150, receive: 0, ssl: -1 }
      }
    ]
  }
};

const samplePostman = {
  info: {
    name: "Sample API Collection",
    schema: "https://schema.getpostman.com/json/collection/v2.1.0/collection.json"
  },
  item: [
    {
      name: "Get Posts",
      request: {
        method: "GET",
        header: [],
        url: {
          raw: "https://jsonplaceholder.typicode.com/posts",
          protocol: "https",
          host: ["jsonplaceholder", "typicode", "com"],
          path: ["posts"]
        }
      }
    },
    {
      name: "Create Post",
      request: {
        method: "POST",
        header: [
          {
            key: "Content-Type",
            value: "application/json"
          }
        ],
        body: {
          mode: "raw",
          raw: '{"title": "Sample Post", "body": "This is a sample post", "userId": 1}'
        },
        url: {
          raw: "https://jsonplaceholder.typicode.com/posts",
          protocol: "https",
          host: ["jsonplaceholder", "typicode", "com"],
          path: ["posts"]
        }
      }
    }
  ]
};