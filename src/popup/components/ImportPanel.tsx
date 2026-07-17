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
import CloudUpload from '@mui/icons-material/CloudUpload';
import InsertDriveFile from '@mui/icons-material/InsertDriveFile';
import Description from '@mui/icons-material/Description';
import Code from '@mui/icons-material/Code';
import Api from '@mui/icons-material/Api';
import Visibility from '@mui/icons-material/Visibility';
import FileUpload from '@mui/icons-material/FileUpload';
import GetApp from '@mui/icons-material/GetApp';
import AutoAwesome from '@mui/icons-material/AutoAwesome';
import { useStore } from '@/store/useStore';
import ImportProgressComponent from './ImportProgress';
import { parseHARFile, parsePostmanCollection, parseOpenAPISpec, parseInsomniaExport } from '@/popup/utils/importParsers';
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
  type: 'har' | 'postman' | 'openapi' | 'insomnia' | 'xhrscribe';
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
  const { importSession } = useStore();
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
        case 'har': {
          const harData = JSON.parse(content);
          if (harData.log?.entries) {
            endpoints = harData.log.entries.length;
            methods = [...new Set(harData.log.entries.map((e: any) => e.request.method))] as string[];
            domains = [...new Set(harData.log.entries.map((e: any) => {
              try { return new URL(e.request.url).hostname; } catch { return 'unknown'; }
            }))] as string[];
          }
          break;
        }

        case 'postman': {
          const collection = JSON.parse(content);
          const items: any[] = [];
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
        }

        case 'openapi': {
          const spec = JSON.parse(content);
          if (spec.paths) {
            Object.entries(spec.paths).forEach(([_path, pathMethods]: [string, any]) => {
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
        }

        case 'insomnia': {
          const data = JSON.parse(content);
          const requests = data.resources?.filter((r: any) => r._type === 'request') || [];
          endpoints = requests.length;
          methods = [...new Set(requests.map((r: any) => r.method))] as string[];
          domains = [...new Set(requests.map((r: any) => {
            try { return new URL(r.url).hostname; } catch { return 'unknown'; }
          }))] as string[];
          break;
        }
      }

      return { endpoints, methods: methods.slice(0, 5), domains: domains.slice(0, 3) };
    } catch {
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
        case 'xhrscribe': {
          const bundle = JSON.parse(content);
          if (!bundle.session || !bundle.session.requests) {
            throw new Error('Invalid XHRScribe bundle: missing session data');
          }
          sessionData = {
            name: bundle.session.name || `Shared Bundle ${new Date().toLocaleDateString()}`,
            url: bundle.session.url,
            requests: bundle.session.requests,
            metadata: { ...bundle.session.metadata, source: 'xhrscribe_import', type: 'imported', bundleVersion: bundle.version },
          };
          break;
        }
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

  const detectFileType = (file: File): 'har' | 'postman' | 'openapi' | 'insomnia' | 'xhrscribe' => {
    const name = file.name.toLowerCase();

    if (name.endsWith('.xhrscribe')) return 'xhrscribe';
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
      reader.onerror = (_e) => reject(new Error('Failed to read file'));
      reader.readAsText(file);
    });
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
          accept=".har,.json,.yaml,.yml,.xhrscribe"
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