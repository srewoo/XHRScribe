import React from 'react';
import {
  Box,
  Typography,
  Button,
  Card,
  CardContent,
  Chip,
  Stack,
  Fade,
} from '@mui/material';
import {
  Delete,
  Preview,
  Rocket,
} from '@mui/icons-material';

interface FilePreviewData {
  file: File;
  type: string;
  preview: {
    endpoints: number;
    methods: string[];
    domains: string[];
  };
}

interface FilePreviewCardProps {
  filePreview: FilePreviewData;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function FilePreviewCard({ filePreview, onConfirm, onCancel }: FilePreviewCardProps) {
  return (
    <Fade in={true}>
      <Card sx={{ mb: 3, border: '2px solid', borderColor: 'primary.main' }}>
        <CardContent>
          <Typography variant="h6" gutterBottom sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Preview color="primary" />
            Import Preview - {filePreview.file.name}
            <Chip
              label={filePreview.type.toUpperCase()}
              size="small"
              color="primary"
              variant="outlined"
            />
          </Typography>

          <Box sx={{ display: 'flex', gap: 2, mb: 3 }}>
            <Box sx={{ flex: 1, textAlign: 'center' }}>
              <Typography variant="h4" color="primary.main" sx={{ fontWeight: 'bold' }}>
                {filePreview.preview.endpoints}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                Endpoints
              </Typography>
            </Box>
            <Box sx={{ flex: 1, textAlign: 'center' }}>
              <Typography variant="h4" color="success.main" sx={{ fontWeight: 'bold' }}>
                {filePreview.preview.methods.length}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                HTTP Methods
              </Typography>
            </Box>
            <Box sx={{ flex: 1, textAlign: 'center' }}>
              <Typography variant="h4" color="warning.main" sx={{ fontWeight: 'bold' }}>
                {filePreview.preview.domains.length}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                Domains
              </Typography>
            </Box>
          </Box>

          <Box sx={{ mb: 2 }}>
            <Typography variant="subtitle2" gutterBottom>Methods:</Typography>
            <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
              {filePreview.preview.methods.map((method) => (
                <Chip key={method} label={method} size="small" variant="outlined" />
              ))}
            </Stack>
          </Box>

          <Box sx={{ mb: 3 }}>
            <Typography variant="subtitle2" gutterBottom>Domains:</Typography>
            <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
              {filePreview.preview.domains.map((domain) => (
                <Chip key={domain} label={domain} size="small" variant="outlined" />
              ))}
            </Stack>
          </Box>

          <Stack direction="row" spacing={2} justifyContent="flex-end">
            <Button
              variant="outlined"
              onClick={onCancel}
              startIcon={<Delete />}
            >
              Cancel
            </Button>
            <Button
              variant="contained"
              onClick={onConfirm}
              startIcon={<Rocket />}
              sx={{ minWidth: 120 }}
            >
              Import Now
            </Button>
          </Stack>
        </CardContent>
      </Card>
    </Fade>
  );
}
