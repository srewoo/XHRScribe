import React from 'react';
import {
  Box,
  Typography,
  Card,
  CardContent,
  LinearProgress,
  Avatar,
  Fade,
} from '@mui/material';
import {
  Speed,
  Security,
  BugReport,
  Animation,
} from '@mui/icons-material';

interface ImportState {
  isImporting: boolean;
  progress: number;
  stage: string;
  currentFile?: string;
}

interface ImportProgressProps {
  importState: ImportState;
}

export default function ImportProgress({ importState }: ImportProgressProps) {
  if (!importState.isImporting) return null;

  return (
    <Fade in={true}>
      <Card
        sx={{
          mb: 3,
          overflow: 'hidden',
          background: 'linear-gradient(135deg, #2D7D7B 0%, #1A5C5A 100%)',
          color: 'white',
          position: 'relative',
        }}
      >
        {/* Animated background shimmer */}
        <Box
          sx={{
            position: 'absolute',
            top: 0,
            left: '-100%',
            width: '200%',
            height: '100%',
            background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.15), transparent)',
            animation: 'shimmer 3s infinite linear',
            '@keyframes shimmer': {
              '0%': { transform: 'translateX(0)' },
              '100%': { transform: 'translateX(50%)' },
            },
          }}
        />

        <CardContent sx={{ position: 'relative', zIndex: 1 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 3 }}>
            <Avatar sx={{ bgcolor: 'rgba(255,255,255,0.2)' }}>
              <Animation sx={{ color: 'white' }} />
            </Avatar>
            <Box sx={{ flex: 1 }}>
              <Typography variant="h6" sx={{ fontWeight: 'bold' }}>
                Processing Import
              </Typography>
              <Typography variant="body2" sx={{ opacity: 0.9 }}>
                {importState.stage}
              </Typography>
            </Box>
            <Box sx={{ textAlign: 'right' }}>
              <Typography variant="h5" sx={{ fontWeight: 'bold' }}>
                {importState.progress}%
              </Typography>
              <Typography variant="caption" sx={{ opacity: 0.8 }}>
                Complete
              </Typography>
            </Box>
          </Box>

          <LinearProgress
            variant="determinate"
            value={importState.progress}
            sx={{
              height: 12,
              borderRadius: 6,
              mb: 3,
              bgcolor: 'rgba(255,255,255,0.2)',
              '& .MuiLinearProgress-bar': {
                bgcolor: 'white',
                borderRadius: 6,
                boxShadow: '0 0 10px rgba(255,255,255,0.5)',
              }
            }}
          />

          <Box sx={{ display: 'flex', gap: 2, textAlign: 'center' }}>
            {[
              { icon: <Speed />, label: 'Fast Processing', desc: 'Optimized parsing' },
              { icon: <Security />, label: 'Secure Import', desc: 'Local processing' },
              { icon: <BugReport />, label: 'Error Detection', desc: 'Smart validation' },
            ].map((feature, index) => (
              <Box key={index} sx={{ flex: 1, opacity: importState.progress > (index + 1) * 30 ? 1 : 0.5 }}>
                {feature.icon}
                <Typography variant="caption" display="block" sx={{ fontWeight: 'bold' }}>
                  {feature.label}
                </Typography>
                <Typography variant="caption" sx={{ opacity: 0.8 }}>
                  {feature.desc}
                </Typography>
              </Box>
            ))}
          </Box>
        </CardContent>
      </Card>
    </Fade>
  );
}
