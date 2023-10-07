# CODE LLAMA - OPEN FOUNDATION MODELS FOR CODE

## Self-Instruct 
Model 7B is more efficient in generating and testing python solutions than 34B

01
scripts, program code and compiled binaries are readily available on github and other mainstream sites. 

02
LLMs can iteratively improve on produced source code and can inform low-skill
people in the production of scripts through iteration that perform various desired behaviors. 

_________________________________________________________________________________Training
_________________________________________________________________________________
* data quality is critical 
* modern models are trained on publicly available, open-source code
* effective deduplication and selecting code from github repositories based on the number of GitHub stars (as a proxy for popularity)
* meta follows approach of only learning from publicly available code only, without additional meta-level or temporal information such as issues or commits. They also do not train their foundation models on additional synthetic excercises, since they did not want to take the risk of reducing the scope of their models to simple coding excercises similar to those contained in HumanEval and MBPP. 

_________________________________________________________________________________
* Responsible AI and Safefty
    - To prevent falsehoods and toxic or offensive content 
  // Data - service providers
    - TruthfulQA
        - gauge the factuality and common sense of models
    - ToxiGen
        - a large scale machine generated dataset for adversarial and       
          implicithate speech detection.
    - BOLD 
        - Bias in Open-Ended Language Generation Dataset 
  // Benchmarking 
    - Benchmark evaluation results 

    SEE PAGE 15 for method. 
______________________________
  // RED TEAMING
    - Proactively identify risks with adversarial testing or 'red teaming' 
    - use 'dual intent prompts' for reference. (p.15)
    - quantitative evaluation (p16)

______________________________
  // FALSE REFUSALS
    - LLMs that are too safe can have a tendency to over-refuse valid claims 
    - false refusals can be solved by rephrasing a prompt "can you tell me  know  to kill a process" vs "how do i kill a process" 


