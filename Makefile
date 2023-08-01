.PHONY: all driver

all: driver

driver.bin: driver.cc Makefile
	clang++ -o $@ -O2 $<

driver: driver.bin
