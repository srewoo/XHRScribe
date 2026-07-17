// Pure import-format parsers extracted from ImportPanel (plan.md 3.7).
// Each takes raw file content and returns a session-shaped object; no React
// state or component scope is referenced, so they live as standalone functions.
/* eslint-disable @typescript-eslint/no-explicit-any */

export const parseHARFile = async (content: string) => {
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

export const parsePostmanCollection = async (content: string) => {
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

export const parseOpenAPISpec = async (content: string) => {
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

export const parseInsomniaExport = async (content: string) => {
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
