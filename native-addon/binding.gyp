{
  "targets": [
    {
      "target_name": "loopback",
      "sources": [
        "src/loopback.cc"
      ],
      "include_dirs": [
        "<!@(node -p \"require('node-addon-api').include\")"
      ],
      "dependencies": [
        "<!(node -p \"require('node-addon-api').gyp\")"
      ],
      "defines": [
        "NAPI_DISABLE_CPP_EXCEPTIONS",
        "UNICODE",
        "_UNICODE"
      ],
      "libraries": [
        "Ole32.lib",
        "Uuid.lib",
        "Avrt.lib"
      ],
      "msvs_settings": {
        "VCCLCompilerTool": {
          "ExceptionHandling": 0,
          "AdditionalOptions": [
            "/std:c++17"
          ]
        }
      }
    }
  ]
}
