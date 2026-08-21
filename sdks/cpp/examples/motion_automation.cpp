#include <ora/client.hpp>
#include <iostream>
#include <thread>
#include <chrono>

class MotionLightAutomation {
public:
    MotionLightAutomation(ora::Client& client, const std::string& motion_sensor,
                         const std::string& light_entity, int brightness, int timeout)
        : client_(client), motion_sensor_(motion_sensor),
          light_entity_(light_entity), brightness_(brightness), timeout_(timeout) {}

    void on_motion_detected() {
        std::cout << "Motion detected!\n";

        // Turn on light
        nlohmann::json data = {{"brightness", brightness_}};
        client_.turn_on(light_entity_, data);

        // Send notification
        ora::NotificationPayload notification{
            .title = "Motion Detected",
            .message = "Turned on " + light_entity_ + " at " + std::to_string(brightness_) + " brightness",
            .priority = "normal"
        };
        client_.send_notification(notification);

        // Store activation time
        auto now = std::chrono::system_clock::now();
        auto timestamp = std::chrono::duration_cast<std::chrono::seconds>(
            now.time_since_epoch()
        ).count();

        client_.set_storage("last_activation", {{"timestamp", timestamp}});
    }

    void on_motion_cleared() {
        std::cout << "Motion cleared, waiting " << timeout_ << "s...\n";

        // Wait for timeout
        std::this_thread::sleep_for(std::chrono::seconds(timeout_));

        // Check if motion is still off
        auto sensor = client_.get_entity(motion_sensor_);
        if (sensor.state == "off") {
            client_.turn_off(light_entity_);

            ora::NotificationPayload notification{
                .title = "Auto-Off",
                .message = "Turned off " + light_entity_ + " after " + std::to_string(timeout_) + "s",
                .priority = "normal"
            };
            client_.send_notification(notification);

            std::cout << "Light turned off\n";
        }
    }

private:
    ora::Client& client_;
    std::string motion_sensor_;
    std::string light_entity_;
    int brightness_;
    int timeout_;
};

int main() {
    try {
        ora::Client client("http://localhost:8080", "api-key");

        MotionLightAutomation automation(
            client,
            "binary_sensor.motion_living_room",
            "light.living_room",
            255,  // brightness
            60    // timeout in seconds
        );

        // Simulate motion detection
        std::cout << "Simulating motion automation...\n";
        automation.on_motion_detected();

        // Wait and simulate motion clearing
        std::this_thread::sleep_for(std::chrono::seconds(2));
        automation.on_motion_cleared();

        std::cout << "Automation complete!\n";

    } catch (const std::exception& e) {
        std::cerr << "Error: " << e.what() << "\n";
        return 1;
    }

    return 0;
}
