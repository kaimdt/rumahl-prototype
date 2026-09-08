cmake_minimum_required(VERSION 3.15)
project(rumahl-sdk VERSION 0.1.0 LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# Find dependencies
find_package(CURL REQUIRED)
find_package(nlohmann_json 3.2.0 REQUIRED)

# Library
add_library(rumahl-sdk
    src/client.cpp
    src/types.cpp
    src/permissions.cpp
    src/manifest.cpp
)

target_include_directories(rumahl-sdk PUBLIC
    $<BUILD_INTERFACE:${CMAKE_CURRENT_SOURCE_DIR}/include>
    $<INSTALL_INTERFACE:include>
)

target_link_libraries(rumahl-sdk PUBLIC
    CURL::libcurl
    nlohmann_json::nlohmann_json
)

# Examples
add_executable(temperature_example examples/temperature_plugin.cpp)
target_link_libraries(temperature_example PRIVATE rumahl-sdk)

add_executable(motion_example examples/motion_automation.cpp)
target_link_libraries(motion_example PRIVATE rumahl-sdk)

# Install
install(TARGETS rumahl-sdk
    EXPORT rumahl-sdk-targets
    LIBRARY DESTINATION lib
    ARCHIVE DESTINATION lib
    RUNTIME DESTINATION bin
)

install(DIRECTORY include/ DESTINATION include)

install(EXPORT rumahl-sdk-targets
    FILE rumahl-sdk-config.cmake
    NAMESPACE ora::
    DESTINATION lib/cmake/rumahl-sdk
)
