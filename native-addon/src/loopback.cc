#include <napi.h>

#define NOMINMAX
#include <windows.h>
#include <audioclient.h>
#include <mmdeviceapi.h>
#include <functiondiscoverykeys_devpkey.h>
#include <mmreg.h>
#include <ks.h>
#include <ksmedia.h>

#include <atomic>
#include <cstdint>
#include <cmath>
#include <memory>
#include <string>
#include <thread>
#include <vector>

namespace {

constexpr uint32_t kDefaultTargetSampleRate = 16000;

struct CaptureState {
  std::atomic<bool> running{false};
  uint32_t targetSampleRate = kDefaultTargetSampleRate;
  uint32_t targetChannels = 1;
  uint64_t resamplePhase = 0;
  bool unsupportedFormatReported = false;
  std::thread worker;
  Napi::ThreadSafeFunction onChunkTsfn;
  Napi::ThreadSafeFunction onErrorTsfn;

  void EmitError(const std::string& message) {
    if (!onErrorTsfn) return;
    auto* payload = new std::string(message);
    auto status = onErrorTsfn.BlockingCall(
      payload,
      [](Napi::Env env, Napi::Function callback, std::string* data) {
        callback.Call({Napi::String::New(env, *data)});
        delete data;
      });
    if (status != napi_ok) {
      delete payload;
    }
  }

  void EmitChunk(std::vector<uint8_t>&& bytes) {
    if (!onChunkTsfn || bytes.empty()) return;
    auto* payload = new std::vector<uint8_t>(std::move(bytes));
    auto status = onChunkTsfn.BlockingCall(
      payload,
      [](Napi::Env env, Napi::Function callback, std::vector<uint8_t>* data) {
        auto buffer = Napi::Buffer<uint8_t>::Copy(env, data->data(), data->size());
        callback.Call({buffer});
        delete data;
      });
    if (status != napi_ok) {
      delete payload;
    }
  }

  void Stop() {
    running.store(false);
    if (worker.joinable()) {
      worker.join();
    }
    if (onChunkTsfn) {
      onChunkTsfn.Release();
      onChunkTsfn = Napi::ThreadSafeFunction();
    }
    if (onErrorTsfn) {
      onErrorTsfn.Release();
      onErrorTsfn = Napi::ThreadSafeFunction();
    }
  }
};

inline bool IsWaveFormatExtensibleFloat(const WAVEFORMATEX* format) {
  if (format->wFormatTag != WAVE_FORMAT_EXTENSIBLE) return false;
  const auto* ext = reinterpret_cast<const WAVEFORMATEXTENSIBLE*>(format);
  return ext->SubFormat == KSDATAFORMAT_SUBTYPE_IEEE_FLOAT;
}

inline bool IsWaveFormatExtensiblePcm(const WAVEFORMATEX* format) {
  if (format->wFormatTag != WAVE_FORMAT_EXTENSIBLE) return false;
  const auto* ext = reinterpret_cast<const WAVEFORMATEXTENSIBLE*>(format);
  return ext->SubFormat == KSDATAFORMAT_SUBTYPE_PCM;
}

inline bool IsFloatFormat(const WAVEFORMATEX* format) {
  return format->wFormatTag == WAVE_FORMAT_IEEE_FLOAT || IsWaveFormatExtensibleFloat(format);
}

inline bool IsPcmFormat(const WAVEFORMATEX* format) {
  return format->wFormatTag == WAVE_FORMAT_PCM || IsWaveFormatExtensiblePcm(format);
}

float ReadSampleAsFloat(const uint8_t* frameData, const WAVEFORMATEX* format, uint16_t channelIndex, bool* supported) {
  *supported = true;
  const uint16_t bits = format->wBitsPerSample;
  const uint16_t bytesPerSample = bits / 8;
  const uint8_t* samplePtr = frameData + channelIndex * bytesPerSample;

  if (IsFloatFormat(format) && bits == 32) {
    float value = *reinterpret_cast<const float*>(samplePtr);
    if (std::isnan(value) || std::isinf(value)) return 0.0f;
    return value;
  }

  if (IsPcmFormat(format) && bits == 16) {
    int16_t value = *reinterpret_cast<const int16_t*>(samplePtr);
    return static_cast<float>(value) / 32768.0f;
  }

  if (IsPcmFormat(format) && bits == 32) {
    int32_t value = *reinterpret_cast<const int32_t*>(samplePtr);
    return static_cast<float>(value / 2147483648.0);
  }

  *supported = false;
  return 0.0f;
}

void ProcessAudioChunk(
  CaptureState* state,
  const WAVEFORMATEX* format,
  const BYTE* data,
  UINT32 frameCount,
  DWORD flags
) {
  if (frameCount == 0) return;

  const uint16_t channels = format->nChannels == 0 ? 1 : format->nChannels;
  const uint16_t blockAlign = format->nBlockAlign;
  std::vector<float> mono(frameCount, 0.0f);

  if ((flags & AUDCLNT_BUFFERFLAGS_SILENT) == 0 && data != nullptr) {
    for (UINT32 frame = 0; frame < frameCount; ++frame) {
      const uint8_t* framePtr = reinterpret_cast<const uint8_t*>(data) + (frame * blockAlign);
      float sum = 0.0f;
      bool supported = true;
      for (uint16_t ch = 0; ch < channels; ++ch) {
        bool sampleSupported = true;
        float sample = ReadSampleAsFloat(framePtr, format, ch, &sampleSupported);
        if (!sampleSupported) {
          supported = false;
          break;
        }
        sum += sample;
      }

      if (!supported) {
        if (!state->unsupportedFormatReported) {
          state->unsupportedFormatReported = true;
          state->EmitError("Unsupported WASAPI format. Supported: float32, int16, int32 PCM.");
        }
        return;
      }

      mono[frame] = sum / static_cast<float>(channels);
    }
  }

  const uint32_t inputRate = format->nSamplesPerSec == 0 ? state->targetSampleRate : format->nSamplesPerSec;
  std::vector<uint8_t> output;
  output.reserve(static_cast<size_t>(frameCount) * 2);

  for (float sample : mono) {
    state->resamplePhase += state->targetSampleRate;
    while (state->resamplePhase >= inputRate) {
      state->resamplePhase -= inputRate;
      float clamped = (sample < -1.0f) ? -1.0f : ((sample > 1.0f) ? 1.0f : sample);
      int16_t pcm = static_cast<int16_t>(std::lround(clamped * 32767.0f));
      output.push_back(static_cast<uint8_t>(pcm & 0xFF));
      output.push_back(static_cast<uint8_t>((pcm >> 8) & 0xFF));
    }
  }

  state->EmitChunk(std::move(output));
}

void RunCaptureLoop(CaptureState* state) {
  HRESULT hr = CoInitializeEx(nullptr, COINIT_MULTITHREADED);
  if (FAILED(hr) && hr != RPC_E_CHANGED_MODE) {
    state->EmitError("CoInitializeEx failed.");
    state->running.store(false);
    return;
  }

  IMMDeviceEnumerator* enumerator = nullptr;
  IMMDevice* device = nullptr;
  IAudioClient* audioClient = nullptr;
  IAudioCaptureClient* captureClient = nullptr;
  WAVEFORMATEX* mixFormat = nullptr;

  do {
    hr = CoCreateInstance(
      __uuidof(MMDeviceEnumerator),
      nullptr,
      CLSCTX_ALL,
      __uuidof(IMMDeviceEnumerator),
      reinterpret_cast<void**>(&enumerator));
    if (FAILED(hr)) {
      state->EmitError("Failed to create MMDeviceEnumerator.");
      break;
    }

    hr = enumerator->GetDefaultAudioEndpoint(eRender, eConsole, &device);
    if (FAILED(hr)) {
      state->EmitError("Failed to get default render endpoint.");
      break;
    }

    hr = device->Activate(__uuidof(IAudioClient), CLSCTX_ALL, nullptr, reinterpret_cast<void**>(&audioClient));
    if (FAILED(hr)) {
      state->EmitError("Failed to activate IAudioClient.");
      break;
    }

    hr = audioClient->GetMixFormat(&mixFormat);
    if (FAILED(hr) || mixFormat == nullptr) {
      state->EmitError("Failed to query mix format.");
      break;
    }

    REFERENCE_TIME bufferDuration = 1000000; // 100ms
    hr = audioClient->Initialize(
      AUDCLNT_SHAREMODE_SHARED,
      AUDCLNT_STREAMFLAGS_LOOPBACK,
      bufferDuration,
      0,
      mixFormat,
      nullptr);
    if (FAILED(hr)) {
      state->EmitError("IAudioClient::Initialize loopback failed.");
      break;
    }

    hr = audioClient->GetService(__uuidof(IAudioCaptureClient), reinterpret_cast<void**>(&captureClient));
    if (FAILED(hr)) {
      state->EmitError("Failed to get IAudioCaptureClient service.");
      break;
    }

    hr = audioClient->Start();
    if (FAILED(hr)) {
      state->EmitError("Failed to start WASAPI loopback stream.");
      break;
    }

    while (state->running.load()) {
      Sleep(10);
      UINT32 packetLength = 0;
      hr = captureClient->GetNextPacketSize(&packetLength);
      if (FAILED(hr)) {
        state->EmitError("GetNextPacketSize failed.");
        break;
      }

      while (packetLength > 0 && state->running.load()) {
        BYTE* data = nullptr;
        UINT32 frames = 0;
        DWORD flags = 0;
        hr = captureClient->GetBuffer(&data, &frames, &flags, nullptr, nullptr);
        if (FAILED(hr)) {
          state->EmitError("GetBuffer failed.");
          break;
        }

        ProcessAudioChunk(state, mixFormat, data, frames, flags);
        captureClient->ReleaseBuffer(frames);

        hr = captureClient->GetNextPacketSize(&packetLength);
        if (FAILED(hr)) {
          state->EmitError("GetNextPacketSize failed.");
          break;
        }
      }
    }

    audioClient->Stop();
  } while (false);

  if (mixFormat) CoTaskMemFree(mixFormat);
  if (captureClient) captureClient->Release();
  if (audioClient) audioClient->Release();
  if (device) device->Release();
  if (enumerator) enumerator->Release();

  CoUninitialize();
  state->running.store(false);
}

void StopCapture(const Napi::CallbackInfo& info) {
  auto* holder = static_cast<std::shared_ptr<CaptureState>*>(info.Data());
  if (holder != nullptr && *holder) {
    (*holder)->Stop();
  }
}

void FinalizeStopCapture(Napi::Env /*env*/, std::shared_ptr<CaptureState>* holder) {
  if (holder != nullptr) {
    if (*holder) {
      (*holder)->Stop();
    }
    delete holder;
  }
}

Napi::Value StartCaptureInternal(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 1 || !info[0].IsObject()) {
    Napi::TypeError::New(env, "options object is required").ThrowAsJavaScriptException();
    return env.Null();
  }

  Napi::Object options = info[0].As<Napi::Object>();
  if (!options.Has("onChunk") || !options.Get("onChunk").IsFunction()) {
    Napi::TypeError::New(env, "options.onChunk function is required").ThrowAsJavaScriptException();
    return env.Null();
  }

  uint32_t sampleRate = kDefaultTargetSampleRate;
  if (options.Has("sampleRate") && options.Get("sampleRate").IsNumber()) {
    sampleRate = options.Get("sampleRate").As<Napi::Number>().Uint32Value();
    if (sampleRate == 0) sampleRate = kDefaultTargetSampleRate;
  }

  Napi::Function onChunk = options.Get("onChunk").As<Napi::Function>();
  Napi::Function onError;
  if (options.Has("onError") && options.Get("onError").IsFunction()) {
    onError = options.Get("onError").As<Napi::Function>();
  }

  auto state = std::make_shared<CaptureState>();
  state->targetSampleRate = sampleRate;
  state->targetChannels = 1;
  state->onChunkTsfn = Napi::ThreadSafeFunction::New(
    env,
    onChunk,
    "loopbackOnChunk",
    0,
    1);

  if (!onError.IsEmpty()) {
    state->onErrorTsfn = Napi::ThreadSafeFunction::New(
      env,
      onError,
      "loopbackOnError",
      0,
      1);
  }

  state->running.store(true);
  state->worker = std::thread([state]() {
    RunCaptureLoop(state.get());
  });

  auto* holder = new std::shared_ptr<CaptureState>(state);
  return Napi::Function::New(env, StopCapture, "stopLoopback", holder, FinalizeStopCapture);
}

Napi::Value StartLoopback(const Napi::CallbackInfo& info) {
  return StartCaptureInternal(info);
}

Napi::Value StartCompat(const Napi::CallbackInfo& info) {
  return StartCaptureInternal(info);
}

Napi::Value CreateLoopbackCapture(const Napi::CallbackInfo& info) {
  return StartCaptureInternal(info);
}

Napi::Object Init(Napi::Env env, Napi::Object exports) {
  exports.Set("startLoopback", Napi::Function::New(env, StartLoopback));
  exports.Set("start", Napi::Function::New(env, StartCompat));
  exports.Set("createLoopbackCapture", Napi::Function::New(env, CreateLoopbackCapture));
  return exports;
}

} // namespace

NODE_API_MODULE(loopback, Init)
