import React, { useState, useMemo } from 'react';
import {
  Box,
  Typography,
  Chip,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  ToggleButtonGroup,
  ToggleButton,
  Alert,
} from '@mui/material';
import { ProtobufDecoder } from '@/services/ProtobufDecoder';

interface ProtobufDetailProps {
  data: string;
  contentType?: string;
}

export default function ProtobufDetail({ data, contentType }: ProtobufDetailProps) {
  const [viewMode, setViewMode] = useState<'decoded' | 'hex'>('decoded');

  const decoder = ProtobufDecoder.getInstance();
  const result = useMemo(() => decoder.decode(data), [data]);

  const formatValue = (value: string | number | Uint8Array): string => {
    if (value instanceof Uint8Array) {
      if (value.length <= 32) {
        return Array.from(value).map(b => b.toString(16).padStart(2, '0')).join(' ');
      }
      return `<${value.length} bytes>`;
    }
    if (typeof value === 'number') return String(value);
    if (typeof value === 'string' && value.length > 100) return value.substring(0, 100) + '...';
    return String(value);
  };

  return (
    <Box>
      {/* Header */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
        <Chip label="gRPC / Protobuf" size="small" color="secondary" />
        {contentType && (
          <Typography variant="caption" color="text.secondary">{contentType}</Typography>
        )}
        <Box sx={{ ml: 'auto' }}>
          <ToggleButtonGroup
            size="small"
            exclusive
            value={viewMode}
            onChange={(_, v) => v && setViewMode(v)}
          >
            <ToggleButton value="decoded" sx={{ px: 1, py: 0.25, fontSize: 11 }}>Decoded</ToggleButton>
            <ToggleButton value="hex" sx={{ px: 1, py: 0.25, fontSize: 11 }}>Hex</ToggleButton>
          </ToggleButtonGroup>
        </Box>
      </Box>

      {viewMode === 'decoded' ? (
        result.success && result.fields.length > 0 ? (
          <TableContainer component={Paper} variant="outlined">
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell sx={{ fontSize: 11, fontWeight: 'bold', py: 0.5 }}>Field #</TableCell>
                  <TableCell sx={{ fontSize: 11, fontWeight: 'bold', py: 0.5 }}>Wire Type</TableCell>
                  <TableCell sx={{ fontSize: 11, fontWeight: 'bold', py: 0.5 }}>Value</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {result.fields.map((field, i) => (
                  <TableRow key={i}>
                    <TableCell sx={{ fontSize: 11, py: 0.5, fontFamily: 'monospace' }}>{field.fieldNumber}</TableCell>
                    <TableCell sx={{ fontSize: 11, py: 0.5 }}>
                      <Chip label={field.wireTypeName} size="small" variant="outlined" sx={{ height: 18, fontSize: 10 }} />
                    </TableCell>
                    <TableCell sx={{ fontSize: 11, py: 0.5, fontFamily: 'monospace', maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {formatValue(field.value)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        ) : (
          <Box>
            {result.error && (
              <Alert severity="warning" sx={{ mb: 1, py: 0, fontSize: 11 }}>
                Decode: {result.error}
              </Alert>
            )}
            <pre style={{ margin: 0, fontSize: 11, overflow: 'auto', maxHeight: 200, whiteSpace: 'pre-wrap' }}>
              {result.rawHex || data}
            </pre>
          </Box>
        )
      ) : (
        <pre style={{ margin: 0, fontSize: 11, overflow: 'auto', maxHeight: 200, fontFamily: 'monospace', whiteSpace: 'pre' }}>
          {result.rawHex || decoder.toHexDump(data)}
        </pre>
      )}

      {/* Stats */}
      {result.success && (
        <Box sx={{ display: 'flex', gap: 0.5, mt: 1 }}>
          <Chip label={`${result.fields.length} fields`} size="small" variant="outlined" sx={{ height: 18, fontSize: 10 }} />
        </Box>
      )}
    </Box>
  );
}
