#ifndef MUSETRIC_MATH_H
#define MUSETRIC_MATH_H
#define M_PI 3.14159265358979323846
#define sqrt __builtin_sqrt
#define sqrtf __builtin_sqrtf
#define floor __builtin_floor
#define floorf __builtin_floorf
#define ceil __builtin_ceil
#define fabs __builtin_fabs
#define fabsf __builtin_fabsf
double acos(double value);
double cos(double value);
double exp(double value);
double exp2(double value);
double log(double value);
double log10(double value);
double pow(double base, double exponent);
static inline long lrint(double value) { return (long)__builtin_rint(value); }
static inline long lrintf(float value) { return (long)__builtin_rintf(value); }
#endif
