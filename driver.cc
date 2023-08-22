#include <linux/hidraw.h>
#include <sys/ioctl.h>
#include <fcntl.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>
#include <unistd.h>

static constexpr int kDevicesToCheck = 20;

int MaybeOpenDevice(const char *device, bool print_errors) {
  struct hidraw_devinfo info;
  memset(&info, 0, sizeof(info));
  int fd = open(device, O_RDWR);
  if (fd < 0) {
    if (print_errors) perror("Unable to open device");
    return fd;
  }
  int res = ioctl(fd, HIDIOCGRAWINFO, &info);
  if (res < 0) {
    close(fd);
    if (print_errors) perror("ioctl failed");
    return -1;
  }
  if (info.vendor != 0x04d9) {
    close(fd);
    if (print_errors) perror("wrong vendor id");
    return -1;
  }
  if (info.product != static_cast<__s16>(0xa052)) {
    close(fd);
    if (print_errors) perror("wrong product id");
    return -1;
  }
  return fd;
}

int DetectDevice() {
  char device[] = "/dev/hidraw00";
  for (int i = 0; i < kDevicesToCheck; i++) {
    snprintf(device, sizeof(device), "/dev/hidraw%d", i);
    int fd = MaybeOpenDevice(device, false);
    if (fd >= 0) {
      printf("Detected device: %s\n", device);
      return fd;
    }
  }
  printf("Didn't detect suitable device.\n");
  return -1;
}

int main(int argc, char **argv) {
  int fd = -1;
  if (argc == 1) {
    fd = DetectDevice();
  } else if (argc == 2 && strcmp(argv[1], "-h") != 0) {
    fd = MaybeOpenDevice(argv[1], true);
  } else {
    printf("Pass a hidraw device as the first and only parameter, or "
           "skip it for auto-detection.\n"
           "You may find the right device with:\n"
           "  dmesg | grep zyTemp | grep input0 | tail -1 |"
           "  sed -e 's/.*hidraw\\([[:digit:]]\\+\\).*/\\/dev\\/hidraw\\1/'\n");
  }
  if (fd < 0) return 1;

  char buf[16];
  memset(buf, 0, sizeof(buf));
  int res = ioctl(fd, HIDIOCSFEATURE(9), buf);
  if (res < 0) {
    perror("HIDIOCSFEATURE");
    return 1;
  }

  while (true) {
    ssize_t count = read(fd, buf, 8);
    if (count != 8) {
      printf("Bad number of bytes read\n");
      break;
    }
    if (buf[4] != 0xd) {
      printf("Missing packet terminator\n");
      break;
    }
    char type = buf[0];
    uint8_t hi = buf[1];
    uint8_t lo = buf[2];
    char checksum = buf[3];
    char sum = type + hi + lo;
    if (sum != checksum) {
      printf("bad checksum, expected %2x but got %2x\n", checksum, sum);
      break;
    }
    int value = (static_cast<int>(hi) << 8) | lo;
    if (type == 0x41) {
      double humidity = static_cast<double>(value) / 100;
      printf("H %d (%.2f %%)\n", value, humidity);
    } else if (type == 0x42) {
      double temperature = static_cast<double>(value) / 16 - 273.15;
      printf("T %d (%.2f °C)\n", value, temperature);
    } else if (type == 0x50) {
      // CO2 concentration.
      printf("C %d ppm\n", value);
    }
    fflush(stdout);
  }
  close(fd);
  return 0;
}
