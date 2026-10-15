
# Define a function to reverse a string
def reverse_string(input_string):
    # Initialize an empty string to hold the reversed string
    reversed_string = ""
    # Loop through each character in the input string in reverse order
    for i in range(len(input_string) - 1, -1, -1):
        # Append the current character to the reversed string
        reversed_string += input_string[i]
    # Return the reversed string
    return reversed_string
# Test the function with a sample input
print(reverse_string("hello world"))  # Output: dlrow olleh