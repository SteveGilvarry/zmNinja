/* jshint -W041 */
/* jslint browser: true*/
/* global angular */

angular.module('zmApp.controllers')
  .factory('MediaHelper', ['$q', function ($q) {

    function getPlugins() {
      var cap = window.Capacitor || {};
      var plugins = cap.Plugins || {};
      if (plugins.Media && plugins.Filesystem) {
        return {
          Media: plugins.Media,
          Filesystem: plugins.Filesystem
        };
      }
      return null;
    }

    function ensurePlugins() {
      var plugins = getPlugins();
      return plugins ? $q.when(plugins) : $q.reject('PLUGIN_MISSING');
    }

    function findAlbumIdentifier(Media, album) {
      if (!album || !Media || typeof Media.getAlbums !== 'function') {
        return $q.when(null);
      }
      return Media.getAlbums().then(function (res) {
        var albums = res && res.albums;
        if (Array.isArray(albums)) {
          for (var i = 0; i < albums.length; i++) {
            var entry = albums[i] || {};
            if (entry.name === album) {
              return entry.identifier || entry.id || entry.localIdentifier || null;
            }
          }
        }
        return null;
      }).catch(function () {
        return null;
      });
    }

    function ensureAlbumIdentifier(Media, album) {
      if (!album) {
        return $q.when(null);
      }

      return findAlbumIdentifier(Media, album).then(function (identifier) {
        if (identifier) return identifier;
        if (!Media || typeof Media.createAlbum !== 'function') return null;
        return Media.createAlbum({ name: album }).catch(function () { return null; })
          .then(function () {
            return findAlbumIdentifier(Media, album);
          });
      });
    }

    function requestPermissions(album) {
      return ensurePlugins().then(function (plugins) {
        var permissionPromise;
        if (plugins.Media && typeof plugins.Media.requestPermissions === 'function') {
          permissionPromise = plugins.Media.requestPermissions();
        } else {
          permissionPromise = $q.when();
        }
        return permissionPromise.then(function () {
          return ensureAlbumIdentifier(plugins.Media, album).then(function (albumIdentifier) {
            return {
              plugins: plugins,
              albumIdentifier: albumIdentifier
            };
          });
        });
      });
    }

    function sanitizeBase64(data) {
      if (!data) return data;
      var sanitized = data;
      if (sanitized.indexOf(',') > -1) {
        sanitized = sanitized.split(',')[1];
      }
      return sanitized;
    }

    function blobToBase64(blob) {
      return $q(function (resolve, reject) {
        var reader = new FileReader();
        reader.onloadend = function () { resolve(reader.result); };
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });
    }

    function writeCacheFile(Filesystem, cachePath, data) {
      return Filesystem.writeFile({
        path: cachePath,
        data: data,
        directory: 'CACHE',
        recursive: true,
        encoding: 'base64'
      });
    }

    function deleteCacheFile(Filesystem, cachePath) {
      return Filesystem.deleteFile({
        path: cachePath,
        directory: 'CACHE'
      }).catch(function () {
        return null;
      });
    }

    function saveBase64(data, options, type) {
      options = options || {};
      if (!options.fileName) {
        return $q.reject('FILE_NAME_REQUIRED');
      }
      var album = options.album || 'zmNinja';
      var cachePath = (options.cachePrefix || ('temp-' + Date.now() + '-')) + options.fileName;

      return requestPermissions(album).then(function (result) {
        var plugins = result.plugins || result;
        var albumIdentifier = result.albumIdentifier || null;
        var sanitized = sanitizeBase64(data);
        return writeCacheFile(plugins.Filesystem, cachePath, sanitized)
          .then(function () {
            return plugins.Filesystem.getUri({ path: cachePath, directory: 'CACHE' });
          })
          .then(function (res) {
            var payload = {
              path: res.uri,
              fileName: options.fileName
            };
            if (albumIdentifier) {
              payload.albumIdentifier = albumIdentifier;
            }
            var savePromise = (type === 'video') ? plugins.Media.saveVideo(payload) : plugins.Media.savePhoto(payload);
            return savePromise.then(function () {
              return deleteCacheFile(plugins.Filesystem, cachePath);
            });
          });
      });
    }

    function savePhotoFromBase64(data, options) {
      return saveBase64(data, options, 'photo');
    }

    function saveVideoFromBase64(data, options) {
      return saveBase64(data, options, 'video');
    }

    function saveBlobAsPhoto(blob, options) {
      return blobToBase64(blob).then(function (dataUrl) {
        return savePhotoFromBase64(dataUrl, options);
      });
    }

    function saveBlobAsVideo(blob, options) {
      return blobToBase64(blob).then(function (dataUrl) {
        return saveVideoFromBase64(dataUrl, options);
      });
    }

    function getFileTransferPlugin() {
      return (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.FileTransfer) || null;
    }

    function downloadFileToCache(options) {
      options = options || {};
      var url = options.url;
      var targetUrl = options.fullPath;
      var onProgress = options.onProgress;
      var headers = options.headers || {};

      var FileTransfer = getFileTransferPlugin();
      if (!FileTransfer || typeof FileTransfer.downloadFile !== 'function') {
        return $q.reject('FILE_TRANSFER_PLUGIN_MISSING');
      }

      if (!url || !targetUrl) {
        return $q.reject('DOWNLOAD_URL_OR_PATH_MISSING');
      }

      var progressListener = null;

      if (typeof onProgress === 'function' && typeof FileTransfer.addListener === 'function') {
        progressListener = FileTransfer.addListener('progress', function (event) {
          try {
            var value = null;
            if (event) {
              if (typeof event.value === 'number') value = event.value;
              else if (typeof event.progress === 'number') value = event.progress;
            }
            if (value !== null) {
              onProgress(Math.min(100, Math.floor(value * 100)));
            }
          } catch (err) {
            console.warn('Progress listener error:', err);
          }
        });
      }

      return FileTransfer.downloadFile({
        url: url,
        path: targetUrl,
        headers: headers,
        progress: typeof onProgress === 'function'
      }).then(function (result) {
        if (progressListener && typeof progressListener.remove === 'function') progressListener.remove();
        if (typeof onProgress === 'function') {
          try { onProgress(100); } catch (err) { console.warn('Progress completion callback error:', err); }
        }
        var downloadPath = result && result.path ? result.path : targetUrl;
        return downloadPath;
      }).catch(function (err) {
        if (progressListener && typeof progressListener.remove === 'function') progressListener.remove();
        return $q.reject(err);
      });
    }

    function saveVideoFromUrl(url, options) {
      options = options || {};
      if (!options.fileName) {
        return $q.reject('FILE_NAME_REQUIRED');
      }
      var album = options.album || 'zmNinja';

      var cachedDownloadPath;
      var cacheDirUri;

      return requestPermissions(album)
        .then(function (result) {
          var plugins = result.plugins || result;
          var albumIdentifier = result.albumIdentifier || null;
          return plugins.Filesystem.getUri({ path: '', directory: 'CACHE' }).then(function (dirRes) {
            cacheDirUri = dirRes && dirRes.uri ? dirRes.uri : '';
            if (!cacheDirUri) {
              throw new Error('CACHE_DIRECTORY_URI_NOT_AVAILABLE');
            }
            if (cacheDirUri.slice(-1) !== '/') cacheDirUri += '/';
            var targetUri = cacheDirUri + options.fileName;
            return downloadFileToCache({
              url: url,
              fullPath: targetUri,
              onProgress: options.onProgress,
              headers: options.headers
            }).then(function (downloadPath) {
              cachedDownloadPath = downloadPath || targetUri;
              return {
                plugins: plugins,
                albumIdentifier: albumIdentifier
              };
            });
          });
        })
        .then(function (result) {
          var plugins = result.plugins || result;
          var albumIdentifier = result.albumIdentifier || null;
          var mediaPath = cachedDownloadPath;
          if (mediaPath && mediaPath.indexOf('file://') !== 0) {
            mediaPath = 'file://' + mediaPath;
          }

          var payload = {
            path: mediaPath,
            fileName: options.fileName
          };
          if (albumIdentifier) {
            payload.albumIdentifier = albumIdentifier;
          }

          return plugins.Media.saveVideo(payload).then(function () {
            return plugins.Filesystem.deleteFile({
              path: options.fileName,
              directory: 'CACHE'
            }).catch(function () {
              var deletePath = cachedDownloadPath;
              if (deletePath && deletePath.indexOf('file://') === 0) {
                deletePath = deletePath.replace('file://', '');
              }
              return deletePath ? plugins.Filesystem.deleteFile({ path: deletePath }).catch(function () { return null; }) : null;
            });
          });
        });
    }

    function savePhotoFromUrl(url, options) {
      options = options || {};
      if (!options.fileName) {
        return $q.reject('FILE_NAME_REQUIRED');
      }
      var album = options.album || 'zmNinja';

      var cachedDownloadPath;
      var cacheDirUri;

      return requestPermissions(album)
        .then(function (result) {
          var plugins = result.plugins || result;
          var albumIdentifier = result.albumIdentifier || null;
          return plugins.Filesystem.getUri({ path: '', directory: 'CACHE' }).then(function (dirRes) {
            cacheDirUri = dirRes && dirRes.uri ? dirRes.uri : '';
            if (!cacheDirUri) {
              throw new Error('CACHE_DIRECTORY_URI_NOT_AVAILABLE');
            }
            if (cacheDirUri.slice(-1) !== '/') cacheDirUri += '/';
            var targetUri = cacheDirUri + options.fileName;
            return downloadFileToCache({
              url: url,
              fullPath: targetUri,
              onProgress: options.onProgress,
              headers: options.headers
            }).then(function (downloadPath) {
              cachedDownloadPath = downloadPath || targetUri;
              var mediaPath = cachedDownloadPath;
              if (mediaPath && mediaPath.indexOf('file://') !== 0) {
                mediaPath = 'file://' + mediaPath;
              }

              var payload = {
                path: mediaPath,
                fileName: options.fileName
              };
              if (albumIdentifier) payload.albumIdentifier = albumIdentifier;

              return plugins.Media.savePhoto(payload).then(function () {
                return plugins.Filesystem.deleteFile({
                  path: options.fileName,
                  directory: 'CACHE'
                }).catch(function () {
                  var deletePath = cachedDownloadPath;
                  if (deletePath && deletePath.indexOf('file://') === 0) {
                    deletePath = deletePath.replace('file://', '');
                  }
                  return deletePath ? plugins.Filesystem.deleteFile({ path: deletePath }).catch(function () { return null; }) : null;
                });
              });
            });
          });
        });
    }

    function base64ToBlob(base64, contentType) {
      contentType = contentType || 'application/octet-stream';
      if (typeof base64 !== 'string') {
        throw new Error('base64ToBlob expects a base64 string');
      }

      var byteCharacters = atob(base64);
      var byteArrays = [];
      var sliceSize = 1024;
      for (var offset = 0; offset < byteCharacters.length; offset += sliceSize) {
        var slice = byteCharacters.slice(offset, offset + sliceSize);
        var byteNumbers = new Array(slice.length);
        for (var i = 0; i < slice.length; i++) {
          byteNumbers[i] = slice.charCodeAt(i);
        }
        byteArrays.push(new Uint8Array(byteNumbers));
      }

      return new Blob(byteArrays, { type: contentType });
    }

    function fetchWithProgress(url, options) {
      options = options || {};
      var onProgress = options.onProgress;
      var fetchOptions = options.fetchOptions || {};

      var Http = (window.Capacitor && ((window.Capacitor.Plugins && window.Capacitor.Plugins.CapacitorHttp) || window.Capacitor.Http)) ||
        window.CapacitorHttp;

      if (Http && typeof Http.get === 'function') {
        var requestOptions = {
          url: url,
          responseType: 'blob'
        };
        if (fetchOptions.headers) requestOptions.headers = fetchOptions.headers;
        if (fetchOptions.params) requestOptions.params = fetchOptions.params;

        return Http.get(requestOptions).then(function (response) {
          if (typeof onProgress === 'function') {
            try {
              onProgress(100);
            } catch (progressErr) {
              console.warn('Progress callback threw an error:', progressErr);
            }
          }

          var data = response.data;
          if (data instanceof Blob) {
            return data;
          }

          if (typeof data === 'string') {
            var headerMap = response.headers || {};
            var headerKey = Object.keys(headerMap).find(function (key) {
              return key.toLowerCase() === 'content-type';
            });
            var contentType = headerKey ? headerMap[headerKey] : 'application/octet-stream';
            try {
              return base64ToBlob(data, contentType);
            } catch (decodeErr) {
              throw decodeErr;
            }
          }

          if (data && typeof data.byteLength !== 'undefined') {
            return new Blob([data], { type: 'application/octet-stream' });
          }

          throw new Error('Unsupported HTTP response type');
        });
      }

      return fetch(url, fetchOptions).then(function (response) {
        if (!response.ok) throw new Error('HTTP ' + response.status);
        var contentType = response.headers.get('Content-Type') || 'application/octet-stream';
        if (!response.body || !window.ReadableStream) {
          return response.blob().then(function (blob) {
            return blob || new Blob([], { type: contentType });
          });
        }
        var total = parseInt(response.headers.get('Content-Length') || '0', 10);
        var received = 0;
        var reader = response.body.getReader();
        var chunks = [];

        function pump() {
          return reader.read().then(function (result) {
            if (result.done) {
              return new Blob(chunks, { type: contentType });
            }
            chunks.push(result.value);
            if (total > 0) {
              received += result.value.byteLength || 0;
              if (typeof onProgress === 'function') {
                onProgress(Math.floor((received / total) * 100));
              }
            }
            return pump();
          });
        }

        return pump();
      });
    }

    return {
      getPlugins: getPlugins,
      ensurePlugins: ensurePlugins,
      requestPermissions: requestPermissions,
      sanitizeBase64: sanitizeBase64,
      blobToBase64: blobToBase64,
      savePhotoFromBase64: savePhotoFromBase64,
      saveVideoFromBase64: saveVideoFromBase64,
      saveBlobAsPhoto: saveBlobAsPhoto,
      saveBlobAsVideo: saveBlobAsVideo,
      savePhotoFromUrl: savePhotoFromUrl,
      saveVideoFromUrl: saveVideoFromUrl,
      downloadFileToCache: downloadFileToCache,
      fetchWithProgress: fetchWithProgress
    };
  }]);
