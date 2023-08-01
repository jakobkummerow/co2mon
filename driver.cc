#include <linux/hidraw.h>
#include <sys/ioctl.h>
#include <fcntl.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>
#include <unistd.h>


int main(int argc, char **argv) {
  if (argc != 2 || strcmp(argv[1], "-h") == 0) {
    printf("Pass a hidraw device as the first and only parameter!\n");
    printf("You may find the right device with:\n");
    printf("  dmesg | grep zyTemp | grep input0 | tail -1 | "
           "sed -e 's/.*hidraw\\([[:digit:]]\\+\\).*/\\/dev\\/hidraw\\1/'\n");
    return 1;
  }
  int fd = open(argv[1], O_RDWR);
  if (fd < 0) {
    perror("Unable to open device");
    return 1;
  }
  struct hidraw_devinfo info;
  memset(&info, 0, sizeof(info));
  int res = ioctl(fd, HIDIOCGRAWINFO, &info);
  if (res < 0) {
    perror("HIDIOCGRAWINFO");
    return 1;
  } else {
    if (info.vendor != 0x04d9) {
      printf("Error: Wrong vendor ID, make sure you got the right "
             "hidraw device!\n");
      return 1;
    }
    if (info.product != static_cast<__s16>(0xa052)) {
      printf("Warning: Unknown product ID 0x%x!\n", info.product);
    }
  }
  char buf[16];
  memset(buf, 0, sizeof(buf));
  res = ioctl(fd, HIDIOCSFEATURE(9), buf);
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
